import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import {
  getAdminSettings,
  getTelegramSubscribers,
  putAdminSetting,
  setTelegramSubscriberActive,
  syncTelegramUsers,
  testAdminEmail,
  testTelegramBot,
} from '@api/admin';
import type { TelegramSubscriber } from '@api/admin';
import {
  AlertCircleIcon,
  BotIcon,
  GroupIcon,
  KeyIcon,
  MailIcon,
  RefreshIcon,
  SaveIcon,
  SendIcon,
} from '@components/ui';
import { cx } from '@utils/cx';
import { errorMessage } from '@utils/errors';
import { useToast } from '@context/toast';

import adminStyles from '@components/admin/Admin.module.css';

const styles = adminStyles;

import { formatDateTime } from './utils';

function subscriberName(subscriber: TelegramSubscriber): string {
  if (subscriber.title.trim()) {
    return subscriber.title;
  }
  const fullName = [subscriber.first_name, subscriber.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || subscriber.username || String(subscriber.chat_id);
}

export default function AdminTelegramPage() {
  const [token, setToken] = useState('');
  const [chatIds, setChatIds] = useState('');
  const [sendToSubscribers, setSendToSubscribers] = useState(false);
  const [botConfigured, setBotConfigured] = useState(false);
  const [emailProvider, setEmailProvider] = useState('smtp');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(1025);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpTestRecipient, setSmtpTestRecipient] = useState('');
  const [smtpTls, setSmtpTls] = useState(false);
  const [smtpStarttls, setSmtpStarttls] = useState(false);
  const [smtpPasswordSet, setSmtpPasswordSet] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [subscribers, setSubscribers] = useState<TelegramSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyChat, setBusyChat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const { pushToast } = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [settings, users] = await Promise.all([
        getAdminSettings(),
        getTelegramSubscribers(),
      ]);
      setBotConfigured(settings.effective.telegram.bot_configured);
      setChatIds(settings.effective.telegram.chat_ids.join('\n'));
      setSendToSubscribers(settings.effective.telegram.send_to_subscribers);
      const email = settings.effective.email;
      setEmailProvider(email.provider);
      setSmtpHost(email.host);
      setSmtpPort(email.port);
      setSmtpUsername(email.username);
      setSmtpFrom(email.from);
      setSmtpTestRecipient(email.test_recipient);
      setSmtpTls(email.tls);
      setSmtpStarttls(email.starttls);
      setSmtpPasswordSet(email.password_set);
      setTwoFactorEnabled(settings.effective.two_factor_enabled);
      setSubscribers(users);
      setUpdatedAt(new Date().toISOString());
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось загрузить настройки Telegram.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const activeSubscribers = useMemo(
    () => subscribers.filter((subscriber) => subscriber.is_active).length,
    [subscribers],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (token.trim()) {
        await putAdminSetting('telegram_bot_token', token.trim());
        setToken('');
      }
      const targets = chatIds
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      await putAdminSetting('telegram_chat_ids', targets);
      await putAdminSetting('telegram_send_to_subscribers', sendToSubscribers);
      pushToast('success', 'Настройки рассылок сохранены.');
      await load();
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось сохранить настройки Telegram.'));
    } finally {
      setSaving(false);
    }
  }

  async function persistEmailSettings() {
    await putAdminSetting('smtp_provider', emailProvider);
    await putAdminSetting('smtp_host', smtpHost.trim());
    await putAdminSetting('smtp_port', smtpPort);
    await putAdminSetting('smtp_username', smtpUsername.trim());
    if (smtpPassword.trim()) {
      await putAdminSetting('smtp_password', smtpPassword.trim());
    }
    await putAdminSetting('smtp_from', smtpFrom.trim());
    await putAdminSetting('smtp_test_recipient', smtpTestRecipient.trim());
    await putAdminSetting('smtp_tls', smtpTls);
    await putAdminSetting('smtp_starttls', smtpStarttls);
    await putAdminSetting('two_factor_enabled', twoFactorEnabled);
  }

  async function handleSaveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingEmail(true);
    try {
      await persistEmailSettings();
      setSmtpPassword('');
      pushToast('success', 'Настройки почты сохранены.');
      await load();
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось сохранить настройки почты.'));
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleTestEmail() {
    setTestingEmail(true);
    try {
      await persistEmailSettings();
      const result = await testAdminEmail(smtpTestRecipient);
      setSmtpPassword('');
      pushToast('success', `Тестовое письмо отправлено на ${result.to}.`);
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось отправить тестовое письмо.'));
    } finally {
      setTestingEmail(false);
    }
  }

  function handleProviderChange(provider: string) {
    setEmailProvider(provider);
    if (provider === 'mailpit') {
      setSmtpHost('mailpit');
      setSmtpPort(1025);
      setSmtpTls(false);
      setSmtpStarttls(false);
      setSmtpUsername('');
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const result = await testTelegramBot();
      pushToast(
        'success',
        result.username
          ? `Бот @${result.username} доступен и готов к отправке.`
          : 'Telegram API ответил: бот доступен.',
      );
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось проверить бота.'));
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncTelegramUsers();
      setSubscribers(result.subscribers);
      pushToast(
        result.updated > 0 ? 'success' : 'info',
        result.updated > 0
          ? `Обновлено пользователей: ${result.updated}.`
          : 'Новых сообщений боту нет. Напишите боту /start и повторите синхронизацию.',
      );
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось синхронизировать пользователей.'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggle(subscriber: TelegramSubscriber) {
    setBusyChat(subscriber.chat_id);
    try {
      await setTelegramSubscriberActive(subscriber.chat_id, !subscriber.is_active);
      setSubscribers((previous) =>
        previous.map((item) =>
          item.chat_id === subscriber.chat_id
            ? { ...item, is_active: !item.is_active }
            : item,
        ),
      );
      pushToast(
        'success',
        subscriber.is_active ? 'Подписчик отключён.' : 'Подписчик включён.',
      );
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось изменить статус пользователя.'));
    } finally {
      setBusyChat(null);
    }
  }

  return (
    <>
      <header className={cx(styles, 'admin-head')}>
        <div>
          <span className={cx(styles, 'admin-eyebrow')}>
            <BotIcon />
            Broadcasts
          </span>
          <h1 className={cx(styles, 'admin-title')}>Рассылки</h1>
          <p className={cx(styles, 'admin-sub')}>
            Telegram-каналы и чаты для публикации дайджеста, а также подписчики,
            которые написали боту.
          </p>
        </div>
        <div className={cx(styles, 'admin-actions')}>
          <button className={cx(styles, 'admin-button')} type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
        </div>
      </header>

      {error && (
        <div className={cx(styles, 'admin-error')} role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}

      <div className={cx(styles, 'admin-stats')}>
        <article className={cx(styles, 'admin-stat')}>
          <span className={cx(styles, 'admin-stat-label')}>
            Бот
            <BotIcon />
          </span>
          <strong className={cx(styles, 'admin-stat-value admin-stat-value--sm')}>
            {botConfigured ? 'Подключён' : 'Не настроен'}
          </strong>
          <span className={cx(styles, 'admin-stat-hint')}>
            {botConfigured ? 'Токен сохранён на сервере' : 'Добавьте токен ниже'}
          </span>
        </article>
        <article className={cx(styles, 'admin-stat')}>
          <span className={cx(styles, 'admin-stat-label')}>
            Каналы и чаты
            <SendIcon />
          </span>
          <strong className={cx(styles, 'admin-stat-value admin-stat-value--sm')}>
            {chatIds.trim() ? chatIds.split(/[\n,]/).filter((value) => value.trim()).length : 0}
          </strong>
          <span className={cx(styles, 'admin-stat-hint')}>
            {sendToSubscribers ? 'плюс подписчики бота' : 'куда отправляется дайджест'}
          </span>
        </article>
        <article className={cx(styles, 'admin-stat')}>
          <span className={cx(styles, 'admin-stat-label')}>
            Пользователей
            <GroupIcon />
          </span>
          <strong className={cx(styles, 'admin-stat-value')}>{subscribers.length}</strong>
          <span className={cx(styles, 'admin-stat-hint')}>
            {activeSubscribers} активных
          </span>
        </article>
        <article className={cx(styles, 'admin-stat')}>
          <span className={cx(styles, 'admin-stat-label')}>
            Обновлено
            <RefreshIcon />
          </span>
          <strong className={cx(styles, 'admin-stat-value admin-stat-value--sm')}>
            {updatedAt ? formatDateTime(updatedAt) : '—'}
          </strong>
          <span className={cx(styles, 'admin-stat-hint')}>Последняя синхронизация</span>
        </article>
      </div>

      <section className={cx(styles, 'admin-card admin-mt-12')}>
        <div className={cx(styles, 'admin-card-head')}>
          <div>
            <h2 className={cx(styles, 'admin-card-title')}>Telegram-бот и доставка</h2>
            <p className={cx(styles, 'admin-card-sub')}>
              Токен, каналы и проверка подключения в одном блоке
            </p>
          </div>
          <span className={cx(styles, 'admin-badge admin-badge--blue')}>
            <KeyIcon />
            Secret
          </span>
        </div>

        <div className={cx(styles, 'admin-bot-status')}>
          <span className={cx(styles, `admin-live-dot${botConfigured ? '' : ' admin-live-dot--off'}`)} />
          <div>
            <strong>{botConfigured ? 'Бот подключён' : 'Бот не настроен'}</strong>
            <span>
              {botConfigured
                ? 'Токен сохранён на сервере'
                : 'Добавьте токен от @BotFather'}
            </span>
          </div>
          <span className={cx(styles, 'admin-badge admin-badge--green')}>
            {subscribers.length} получателей
          </span>
        </div>

        <form className={cx(styles, 'admin-form admin-form--telegram')} onSubmit={handleSave}>
          <label className={cx(styles, 'admin-field')}>
            <span>Токен бота</span>
            <input
              autoComplete="off"
              className={cx(styles, 'admin-input')}
              placeholder={
                botConfigured
                  ? 'Токен сохранён. Введите новый, чтобы заменить'
                  : '123456789:AA...'
              }
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <small className={cx(styles, 'admin-field-hint')}>
              Получите токен у @BotFather и вставьте сюда.
            </small>
          </label>
          <div className={cx(styles, 'admin-toggle-tile')}>
            <button
              aria-checked={sendToSubscribers}
              aria-label="Отправлять пользователям, написавшим боту"
              className={cx(styles, `admin-toggle${
                sendToSubscribers ? ' admin-toggle--on' : ''
              }`)}
              role="switch"
              type="button"
              onClick={() => setSendToSubscribers((value) => !value)}
            >
              <span className={cx(styles, 'admin-toggle-thumb')} />
            </button>
            <div>
              <strong>Пользователи бота</strong>
              <span>Отправлять всем, кто написал боту</span>
            </div>
          </div>
          <label className={cx(styles, 'admin-field admin-field--wide')}>
            <span>Каналы и чаты для доставки</span>
            <textarea
              className={cx(styles, 'admin-input')}
              placeholder={'-1001234567890\n@channel'}
              rows={5}
              value={chatIds}
              onChange={(event) => setChatIds(event.target.value)}
            />
            <small className={cx(styles, 'admin-field-hint')}>
              По одному ID или @username в строке. Можно вставить список через запятую.
            </small>
          </label>
          <div className={cx(styles, 'admin-form-actions')}>
            <button
              className={cx(styles, 'admin-button')}
              type="button"
              disabled={testing || !botConfigured}
              onClick={() => void handleTest()}
            >
              <SendIcon />
              {testing ? 'Проверяем…' : 'Проверить бота'}
            </button>
            <button
              className={cx(styles, 'admin-button')}
              type="button"
              disabled={syncing || !botConfigured}
              onClick={() => void handleSync()}
            >
              <RefreshIcon />
              {syncing ? 'Синхронизируем…' : 'Синхронизировать пользователей'}
            </button>
            <button
              className={cx(styles, 'admin-button admin-button--primary')}
              type="submit"
              disabled={saving || loading}
            >
              <SaveIcon />
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>

        <p className={cx(styles, 'admin-note admin-mt-10')}>
          Синхронизация использует Telegram getUpdates. Если у бота настроен webhook,
          сначала отключите его в BotFather. Для канала добавьте бота администратором
          и укажите его chat id.
        </p>
      </section>

      <section className={cx(styles, 'admin-card admin-mt-12')}>
        <div className={cx(styles, 'admin-card-head')}>
          <div>
            <h2 className={cx(styles, 'admin-card-title')}>Пользователи Telegram</h2>
            <p className={cx(styles, 'admin-card-sub')}>
              Чаты, которые взаимодействовали с ботом
            </p>
          </div>
          <span className={cx(styles, 'admin-badge admin-badge--blue')}>
            <GroupIcon />
            {subscribers.length}
          </span>
        </div>

        <div className={cx(styles, 'admin-table-wrap')}>
          <table className={cx(styles, 'admin-table admin-table--telegram')}>
            <thead>
              <tr>
                <th>Пользователь / чат</th>
                <th>Chat ID</th>
                <th>Username</th>
                <th>Тип</th>
                <th>Последняя активность</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subscribers.map((subscriber) => (
                <tr key={subscriber.chat_id}>
                  <td className={cx(styles, 'admin-cell-strong')}>
                    {subscriberName(subscriber)}
                  </td>
                  <td className={cx(styles, 'admin-mono')}>{subscriber.chat_id}</td>
                  <td>
                    {subscriber.username ? (
                      <span className={cx(styles, 'admin-mono')}>@{subscriber.username}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{subscriber.chat_type}</td>
                  <td className={cx(styles, 'admin-mono')}>
                    {formatDateTime(subscriber.last_seen_at)}
                  </td>
                  <td>
                    <span
                      className={cx(
                        styles,
                        `admin-badge ${
                          subscriber.is_active ? 'admin-badge--green' : 'admin-badge--red'
                        }`,
                      )}
                    >
                      {subscriber.is_active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td>
                    <button
                      className={cx(styles, 'admin-button admin-button--small')}
                      type="button"
                      disabled={busyChat === subscriber.chat_id}
                      onClick={() => void handleToggle(subscriber)}
                    >
                      {subscriber.is_active ? 'Отключить' : 'Включить'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && subscribers.length === 0 && (
            <p className={cx(styles, 'admin-empty')}>
              Пользователей пока нет. Отправьте боту /start и нажмите
              «Синхронизировать пользователей».
            </p>
          )}
          {loading && <p className={cx(styles, 'admin-empty')}>Загружаем пользователей…</p>}
        </div>
      </section>
      <section className={cx(styles, 'admin-card admin-mt-12')}>
        <div className={cx(styles, 'admin-card-head')}>
          <div>
            <h2 className={cx(styles, 'admin-card-title')}>Почта и SMTP</h2>
            <p className={cx(styles, 'admin-card-sub')}>
              Для рассылок дайджестов, подтверждения почты и восстановления пароля
            </p>
          </div>
          <span className={cx(styles, 'admin-badge admin-badge--blue')}>
            <MailIcon />
            {smtpPasswordSet ? 'Пароль сохранён' : 'Не настроено'}
          </span>
        </div>

        <form className={cx(styles, 'admin-form')} onSubmit={handleSaveEmail}>
          <div className={cx(styles, 'admin-toggle-tile admin-toggle-tile--wide')}>
            <button
              aria-checked={twoFactorEnabled}
              aria-label="Двухфакторная аутентификация"
              className={cx(styles, `admin-toggle${
                twoFactorEnabled ? ' admin-toggle--on' : ''
              }`)}
              role="switch"
              type="button"
              onClick={() => setTwoFactorEnabled((value) => !value)}
            >
              <span className={cx(styles, 'admin-toggle-thumb')} />
            </button>
            <div>
              <strong>Двухфакторная аутентификация</strong>
              <span>
                Код на почту после ввода пароля. Если выключено, пользователи не видят
                эту настройку в профиле.
              </span>
            </div>
          </div>
          <label className={cx(styles, 'admin-field')}>
            <span>Провайдер</span>
            <select
              className={cx(styles, 'admin-select')}
              value={emailProvider}
              onChange={(event) => handleProviderChange(event.target.value)}
            >
              <option value="smtp">SMTP</option>
              <option value="mailpit">Mailpit</option>
            </select>
          </label>
          <label className={cx(styles, 'admin-field')}>
            <span>SMTP host</span>
            <input
              className={cx(styles, 'admin-input')}
              placeholder="smtp.mail.ru"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
            />
          </label>
          <label className={cx(styles, 'admin-field')}>
            <span>Порт</span>
            <input
              className={cx(styles, 'admin-input')}
              min={1}
              max={65535}
              type="number"
              value={smtpPort}
              onChange={(event) => setSmtpPort(Number(event.target.value))}
            />
          </label>
          <label className={cx(styles, 'admin-field')}>
            <span>Логин</span>
            <input
              autoComplete="off"
              className={cx(styles, 'admin-input')}
              value={smtpUsername}
              onChange={(event) => setSmtpUsername(event.target.value)}
            />
          </label>
          <label className={cx(styles, 'admin-field')}>
            <span>Пароль</span>
            <input
              autoComplete="new-password"
              className={cx(styles, 'admin-input')}
              placeholder={smtpPasswordSet ? 'Пароль сохранён' : 'Пароль SMTP'}
              type="password"
              value={smtpPassword}
              onChange={(event) => setSmtpPassword(event.target.value)}
            />
          </label>
          <label className={cx(styles, 'admin-field')}>
            <span>Отправитель</span>
            <input
              className={cx(styles, 'admin-input')}
              placeholder="digest@example.com"
              value={smtpFrom}
              onChange={(event) => setSmtpFrom(event.target.value)}
            />
          </label>
          <label className={cx(styles, 'admin-field')}>
            <span>Тестовый получатель</span>
            <input
              className={cx(styles, 'admin-input')}
              placeholder="test@example.com"
              value={smtpTestRecipient}
              onChange={(event) => setSmtpTestRecipient(event.target.value)}
            />
          </label>
          <div className={cx(styles, 'admin-user-status')}>
            <button
              aria-checked={smtpTls}
              aria-label="TLS"
              className={cx(styles, `admin-toggle${smtpTls ? ' admin-toggle--on' : ''}`)}
              role="switch"
              type="button"
              onClick={() => setSmtpTls((value) => !value)}
            >
              <span className={cx(styles, 'admin-toggle-thumb')} />
            </button>
            <span>TLS</span>
          </div>
          <div className={cx(styles, 'admin-user-status')}>
            <button
              aria-checked={smtpStarttls}
              aria-label="STARTTLS"
              className={cx(styles, `admin-toggle${smtpStarttls ? ' admin-toggle--on' : ''}`)}
              role="switch"
              type="button"
              onClick={() => setSmtpStarttls((value) => !value)}
            >
              <span className={cx(styles, 'admin-toggle-thumb')} />
            </button>
            <span>STARTTLS</span>
          </div>
          <div className={cx(styles, 'admin-form-actions')}>
            <button
              className={cx(styles, 'admin-button')}
              type="button"
              disabled={testingEmail || savingEmail}
              onClick={() => void handleTestEmail()}
            >
              <SendIcon />
              {testingEmail ? 'Отправляем…' : 'Отправить тест'}
            </button>
            <button
              className={cx(styles, 'admin-button admin-button--primary')}
              type="submit"
              disabled={savingEmail || testingEmail}
            >
              <SaveIcon />
              {savingEmail ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>
        <p className={cx(styles, 'admin-note admin-mt-10')}>
          Mailpit — локальный SMTP для разработки: host <code>mailpit</code>, порт 1025,
          без TLS. Для внешнего почтового провайдера укажите SMTP-хост, порт и пароль.
        </p>
      </section>

    </>
  );
}
