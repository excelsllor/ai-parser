import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import {
  getAdminSettings,
  getTelegramSubscribers,
  putAdminSetting,
  setTelegramSubscriberActive,
  syncTelegramUsers,
  testTelegramBot,
} from '@api/admin';
import type { TelegramSubscriber } from '@api/admin';
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircleIcon,
  GroupIcon,
  KeyIcon,
  RefreshIcon,
  SaveIcon,
  SendIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

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
  const [chatId, setChatId] = useState('');
  const [botConfigured, setBotConfigured] = useState(false);
  const [subscribers, setSubscribers] = useState<TelegramSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyChat, setBusyChat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [settings, users] = await Promise.all([
        getAdminSettings(),
        getTelegramSubscribers(),
      ]);
      setBotConfigured(settings.effective.telegram.bot_configured);
      setChatId(settings.effective.telegram.chat_id);
      setSubscribers(users);
      setUpdatedAt(new Date().toISOString());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить настройки Telegram.',
      );
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
    setError(null);
    setNotice(null);
    try {
      if (token.trim()) {
        await putAdminSetting('telegram_bot_token', token.trim());
        setToken('');
      }
      await putAdminSetting('telegram_chat_id', chatId.trim());
      setNotice('Настройки Telegram сохранены.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось сохранить настройки Telegram.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await testTelegramBot();
      setNotice(
        result.username
          ? `Бот @${result.username} доступен и готов к отправке.`
          : 'Telegram API ответил: бот доступен.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось проверить бота.');
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncTelegramUsers();
      setSubscribers(result.subscribers);
      setNotice(
        result.updated > 0
          ? `Обновлено пользователей: ${result.updated}.`
          : 'Новых сообщений боту нет. Напишите боту /start и повторите синхронизацию.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось синхронизировать пользователей.',
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggle(subscriber: TelegramSubscriber) {
    setBusyChat(subscriber.chat_id);
    setError(null);
    try {
      await setTelegramSubscriberActive(subscriber.chat_id, !subscriber.is_active);
      setSubscribers((previous) =>
        previous.map((item) =>
          item.chat_id === subscriber.chat_id
            ? { ...item, is_active: !item.is_active }
            : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось изменить статус пользователя.',
      );
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
            Telegram integration
          </span>
          <h1 className={cx(styles, 'admin-title')}>Telegram-бот</h1>
          <p className={cx(styles, 'admin-sub')}>
            Токен бота, канал для публикации дайджеста и список пользователей,
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
      {notice && (
        <div className={cx(styles, 'admin-notice')} role="status">
          <CheckCircleIcon />
          <span>{notice}</span>
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
            Канал / чат
            <SendIcon />
          </span>
          <strong className={cx(styles, 'admin-stat-value admin-stat-value--sm')}>
            {chatId || '—'}
          </strong>
          <span className={cx(styles, 'admin-stat-hint')}>Куда отправляется дайджест</span>
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

      <div className={cx(styles, 'admin-grid')}>
        <section className={cx(styles, 'admin-card')}>
          <div className={cx(styles, 'admin-card-head')}>
            <div>
              <h2 className={cx(styles, 'admin-card-title')}>Подключение бота</h2>
              <p className={cx(styles, 'admin-card-sub')}>
                Токен создаётся у @BotFather и хранится только в настройках платформы
              </p>
            </div>
            <span className={cx(styles, 'admin-badge admin-badge--blue')}>
              <KeyIcon />
              Secret
            </span>
          </div>

          <form className={cx(styles, 'admin-form')} onSubmit={handleSave}>
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
            </label>
            <label className={cx(styles, 'admin-field')}>
              <span>ID канала или чата</span>
              <input
                className={cx(styles, 'admin-input')}
                placeholder="-1001234567890 или @channel"
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
              />
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
            Чтобы получить пользователей: отправьте боту команду <strong>/start</strong>,
            затем нажмите «Синхронизировать». Для канала добавьте бота администратором
            и укажите его chat id.
          </p>
        </section>

        <section className={cx(styles, 'admin-card')}>
          <div className={cx(styles, 'admin-card-head')}>
            <div>
              <h2 className={cx(styles, 'admin-card-title')}>Проверка подключения</h2>
              <p className={cx(styles, 'admin-card-sub')}>
                Проверьте токен и синхронизируйте список пользователей
              </p>
            </div>
          </div>
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
          </div>
          <p className={cx(styles, 'admin-note admin-mt-12')}>
            Синхронизация использует Telegram getUpdates. Если у бота настроен webhook,
            сначала отключите его в BotFather или через API.
          </p>
        </section>
      </div>

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
          <table className={cx(styles, 'admin-table')}>
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
    </>
  );
}
