import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { clearSession, getCurrentUser, getMe } from '@api/auth';
import type { CurrentUser } from '@api/auth';
import AppHeader from '@components/layout/AppHeader';
import {
  AlternateEmailIcon,
  ArrowLeftIcon,
  BadgeIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DevicesIcon,
  EmailReadIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LaptopIcon,
  LockIcon,
  LogoutIcon,
  MailIcon,
  PasswordIcon,
  PhoneIcon,
  SaveIcon,
  UserIcon,
  VerifiedUserIcon,
} from '@components/ui/icons';

import '@components/workspace/workspace.css';
import './ProfilePage.css';

const roleLabel = (role: string | undefined): string => {
  if (role === 'admin') {
    return 'Администратор';
  }
  if (role === 'analyst') {
    return 'Аналитик';
  }
  return role ?? 'Пользователь';
};

const accessLabel = (role: string | undefined): string =>
  role === 'admin'
    ? 'Администратор (полный доступ к конвейеру)'
    : 'Tier-3 Analyst (доступ к конвейеру дайджестов)';

function formatDate(value: string | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function deviceInfo(): { title: string; subtitle: string; icon: 'phone' | 'laptop' } {
  const ua = navigator.userAgent;
  const browser = /Firefox/.test(ua)
    ? 'Firefox'
    : /Edg/.test(ua)
      ? 'Edge'
      : /Chrome/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Браузер';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Linux/.test(ua)
          ? 'Linux'
          : 'ОС';
  const phone = /iPhone|Android.*Mobile/.test(ua);

  return {
    title: `${browser} / ${os}`,
    subtitle: phone ? 'Мобильное устройство' : 'Рабочая станция',
    icon: phone ? 'phone' : 'laptop',
  };
}

export default function ProfilePage() {
  const navigate = useNavigate();

  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);

  const device = useMemo(() => deviceInfo(), []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const user = await getMe();
        if (active) {
          setMe(user);
        }
      } catch {
        if (active) {
          const local = getCurrentUser();
          setMe({
            id: '',
            username: local?.username ?? '—',
            role: local?.role ?? 'analyst',
            is_active: true,
            created_at: '',
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const initials = (me?.username ?? '?').slice(0, 2).toUpperCase();
  const passwordStrength = useMemo(() => {
    let score = 0;
    if (newPassword.length >= 12) {
      score += 1;
    }
    if (/[A-ZА-Я]/.test(newPassword) && /[a-zа-я]/.test(newPassword)) {
      score += 1;
    }
    if (/\d/.test(newPassword) && /[^A-Za-zА-Яа-я0-9]/.test(newPassword)) {
      score += 1;
    }
    return score;
  }, [newPassword]);

  function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!newEmail.trim() || newEmail !== confirmEmail) {
      setNotice('Введите новый email и подтвердите его.');
      return;
    }

    setNotice('Смена email пока не подключена к backend. Форма готова к следующему этапу.');
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!currentPassword || newPassword.length < 12) {
      setNotice('Новый пароль должен быть не короче 12 символов.');
      return;
    }
    if (newPassword !== repeatPassword) {
      setNotice('Пароли не совпадают.');
      return;
    }

    setNotice('Смена пароля пока не подключена к backend. Форма готова к следующему этапу.');
  }

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  function navigateStub(label: string) {
    setNotice(`Раздел «${label}» пока не подключён.`);
  }

  return (
    <div className="ws-page pf-page">
      <AppHeader
        onBrandClick={() => navigate('/')}
        sub="Security Ops"
        nav={
          <nav className="pf-nav" aria-label="Основное меню">
            <button className="pf-nav-item" type="button" onClick={() => navigate('/')}>
              Мониторинг
            </button>
            <button className="pf-nav-item" type="button" onClick={() => navigateStub('Инциденты')}>
              Инциденты
            </button>
            <button className="pf-nav-item" type="button" onClick={() => navigateStub('Разведка угроз')}>
              Разведка угроз
            </button>
            <button className="pf-nav-item" type="button" onClick={() => navigateStub('Журнал аудита')}>
              Журнал аудита
            </button>
            {me?.role === 'admin' && (
              <button
                className="pf-nav-item"
                type="button"
                onClick={() => navigate('/admin')}
              >
                Администрирование
              </button>
            )}
            <button className="pf-nav-item pf-nav-item--active" type="button">
              <UserIcon />
              Профиль
            </button>
          </nav>
        }
      >
        <div className="pf-user-chip">
          <span className="pf-avatar pf-avatar--small">{initials}</span>
          <span className="pf-user-chip-text">
            <span>{me?.username ?? 'Пользователь'}</span>
            <span>{roleLabel(me?.role)}</span>
          </span>
        </div>

        <button
          className="pf-back"
          type="button"
          title="Назад в рабочее пространство"
          aria-label="Назад в рабочее пространство"
          onClick={() => navigate('/')}
        >
          <ArrowLeftIcon />
        </button>
      </AppHeader>

      <main className="pf-main">
        <div className="pf-breadcrumbs">
          <span>CyberBug</span>
          <span>/</span>
          <span>Настройки учетной записи</span>
        </div>
        <h1 className="pf-title">Профиль пользователя</h1>
        <p className="pf-subtitle">
          Управление персональными данными, контактным email, паролем и текущими сессиями
          в системе.
        </p>

        {notice && (
          <div className="pf-notice" role="status">
            <CheckCircleIcon />
            <span>{notice}</span>
          </div>
        )}

        <div className="pf-cards">
          <details className="pf-card" open>
            <summary className="pf-card-head">
              <span className="pf-card-head-left">
                <span className="pf-card-icon">
                  <BadgeIcon />
                </span>
                <span>
                  <strong>Информация о пользователе</strong>
                  <small>Личные данные и служебная информация аккаунта</small>
                </span>
              </span>
              <ChevronDownIcon className="pf-chevron" />
            </summary>

            <div className="pf-card-body">
              <div className="pf-profile-strip">
                <div className="pf-profile-main">
                  <span className="pf-avatar">{initials}</span>
                  <div>
                    <div className="pf-profile-name-row">
                      <strong>{me?.username ?? 'Пользователь'}</strong>
                      <span className="pf-mono">@{me?.username ?? 'user'}</span>
                    </div>
                    <p className="pf-profile-role">
                      <VerifiedUserIcon />
                      {accessLabel(me?.role)}
                    </p>
                  </div>
                </div>
                <div className="pf-registered">
                  <span>Дата регистрации:</span>
                  <strong>{formatDate(me?.created_at)}</strong>
                </div>
              </div>

              <div className="pf-fields">
                <label className="pf-field">
                  <span>Логин</span>
                  <input value={me?.username ?? ''} readOnly disabled />
                </label>
                <label className="pf-field">
                  <span>Роль</span>
                  <input value={roleLabel(me?.role)} readOnly disabled />
                </label>
                <label className="pf-field">
                  <span>Статус аккаунта</span>
                  <input value={me?.is_active ? 'Активен' : 'Отключён'} readOnly disabled />
                </label>
                <label className="pf-field">
                  <span>Идентификатор</span>
                  <input value={me?.id || '—'} readOnly disabled />
                </label>
              </div>

              <div className="pf-form-actions">
                <span className="pf-readonly-note">
                  {loading ? 'Загрузка данных…' : 'Данные аккаунта доступны только для чтения.'}
                </span>
              </div>
            </div>
          </details>

          <details className="pf-card" open>
            <summary className="pf-card-head">
              <span className="pf-card-head-left">
                <span className="pf-card-icon">
                  <EmailReadIcon />
                </span>
                <span>
                  <strong>Смена адреса электронной почты</strong>
                  <small>Обновление основного контактного адреса профиля</small>
                </span>
              </span>
              <ChevronDownIcon className="pf-chevron" />
            </summary>

            <div className="pf-card-body">
              <form className="pf-form" onSubmit={handleEmailSubmit}>
                <div className="pf-fields">
                  <label className="pf-field">
                    <span>Текущий адрес эл. почты</span>
                    <div className="pf-input-wrap">
                      <LockIcon className="pf-input-icon" />
                      <input value="Не задан" readOnly disabled />
                    </div>
                    <small>Почта не привязана к аккаунту</small>
                  </label>
                  <label className="pf-field">
                    <span>Новый адрес эл. почты</span>
                    <div className="pf-input-wrap">
                      <AlternateEmailIcon className="pf-input-icon" />
                      <input
                        type="email"
                        placeholder="analyst.new@enterprise.sec"
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                      />
                    </div>
                  </label>
                  <label className="pf-field">
                    <span>Повторите новый email</span>
                    <div className="pf-input-wrap">
                      <MailIcon className="pf-input-icon" />
                      <input
                        type="email"
                        placeholder="analyst.new@enterprise.sec"
                        value={confirmEmail}
                        onChange={(event) => setConfirmEmail(event.target.value)}
                      />
                    </div>
                  </label>
                </div>

                <div className="pf-form-actions">
                  <button
                    className="pf-button pf-button--ghost"
                    type="button"
                    onClick={() => {
                      setNewEmail('');
                      setConfirmEmail('');
                      setNotice(null);
                    }}
                  >
                    Отмена
                  </button>
                  <button className="pf-button pf-button--primary" type="submit">
                    <MailIcon />
                    Сохранить email
                  </button>
                </div>
              </form>
            </div>
          </details>

          <details className="pf-card" open>
            <summary className="pf-card-head">
              <span className="pf-card-head-left">
                <span className="pf-card-icon">
                  <PasswordIcon />
                </span>
                <span>
                  <strong>Изменение пароля</strong>
                  <small>Регулярная смена пароля повышает безопасность аккаунта</small>
                </span>
              </span>
              <ChevronDownIcon className="pf-chevron" />
            </summary>

            <div className="pf-card-body">
              <form className="pf-form" onSubmit={handlePasswordSubmit}>
                <label className="pf-field">
                  <span className="pf-label-row">
                    Текущий пароль
                    <button className="pf-link" type="button" onClick={() => setNotice('Восстановление пароля пока не подключено.')}>
                      Забыли пароль?
                    </button>
                  </span>
                  <div className="pf-input-wrap">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      placeholder="Введите текущий пароль"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                    <button
                      className="pf-eye"
                      type="button"
                      aria-label={showCurrentPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowCurrentPassword((value) => !value)}
                    >
                      {showCurrentPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </label>

                <label className="pf-field">
                  <span>Новый пароль</span>
                  <div className="pf-input-wrap">
                    <KeyIcon className="pf-input-icon" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Минимум 12 символов"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <button
                      className="pf-eye"
                      type="button"
                      aria-label={showNewPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowNewPassword((value) => !value)}
                    >
                      {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </label>

                <div className="pf-strength">
                  <div className="pf-strength-head">
                    <span>Сложность пароля</span>
                    <strong>{passwordStrength === 3 ? 'Надёжный' : passwordStrength === 2 ? 'Средний' : 'Слабый'}</strong>
                  </div>
                  <div className="pf-strength-bar">
                    {[0, 1, 2].map((index) => (
                      <span
                        className={index < passwordStrength ? 'pf-strength-segment pf-strength-segment--on' : 'pf-strength-segment'}
                        key={index}
                      />
                    ))}
                  </div>
                  <div className="pf-strength-hints">
                    <span className={newPassword.length >= 12 ? 'pf-hint pf-hint--ok' : 'pf-hint'}>
                      <CheckCircleIcon />
                      Минимум 12 символов
                    </span>
                    <span className={/[A-ZА-Я]/.test(newPassword) && /[a-zа-я]/.test(newPassword) ? 'pf-hint pf-hint--ok' : 'pf-hint'}>
                      <CheckCircleIcon />
                      Заглавные и строчные буквы
                    </span>
                    <span className={/\d/.test(newPassword) && /[^A-Za-zА-Яа-я0-9]/.test(newPassword) ? 'pf-hint pf-hint--ok' : 'pf-hint'}>
                      <CheckCircleIcon />
                      Цифры и спецсимволы (!@#$)
                    </span>
                  </div>
                </div>

                <label className="pf-field">
                  <span>Повторите новый пароль</span>
                  <div className="pf-input-wrap">
                    <KeyIcon className="pf-input-icon" />
                    <input
                      type={showRepeatPassword ? 'text' : 'password'}
                      placeholder="Повторите новый пароль"
                      value={repeatPassword}
                      onChange={(event) => setRepeatPassword(event.target.value)}
                    />
                    <button
                      className="pf-eye"
                      type="button"
                      aria-label={showRepeatPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowRepeatPassword((value) => !value)}
                    >
                      {showRepeatPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {repeatPassword && repeatPassword === newPassword && (
                    <small className="pf-match">
                      <CheckCircleIcon />
                      Пароли совпадают
                    </small>
                  )}
                </label>

                <div className="pf-form-actions">
                  <button
                    className="pf-button pf-button--ghost"
                    type="button"
                    onClick={() => {
                      setCurrentPassword('');
                      setNewPassword('');
                      setRepeatPassword('');
                      setNotice(null);
                    }}
                  >
                    Отмена
                  </button>
                  <button className="pf-button pf-button--primary" type="submit">
                    <SaveIcon />
                    Сохранить новый пароль
                  </button>
                </div>
              </form>
            </div>
          </details>

          <details className="pf-card" open>
            <summary className="pf-card-head">
              <span className="pf-card-head-left">
                <span className="pf-card-icon">
                  <DevicesIcon />
                </span>
                <span>
                  <strong>
                    Активные сессии
                    <span className="pf-count">1</span>
                  </strong>
                  <small>Устройства, с которых выполнен вход в ваш аккаунт</small>
                </span>
              </span>
              <ChevronDownIcon className="pf-chevron" />
            </summary>

            <div className="pf-card-body">
              <div className="pf-session">
                <div className="pf-session-main">
                  <span className="pf-session-icon">
                    {device.icon === 'phone' ? <PhoneIcon /> : <LaptopIcon />}
                  </span>
                  <div>
                    <div className="pf-session-title">
                      {device.title}
                      <span className="pf-session-badge">Этот браузер</span>
                    </div>
                    <div className="pf-session-meta">
                      <span>{device.subtitle}</span>
                      <span>•</span>
                      <span className="pf-online">Онлайн сейчас</span>
                    </div>
                  </div>
                </div>
                <button className="pf-button pf-button--danger" type="button" onClick={handleLogout}>
                  <LogoutIcon />
                  Выйти
                </button>
              </div>

              <div className="pf-form-actions pf-form-actions--between">
                <span className="pf-readonly-note">
                  Другие сессии не отслеживаются в текущей версии backend.
                </span>
                <button
                  className="pf-button pf-button--ghost"
                  type="button"
                  onClick={() => setNotice('Завершение других сессий появится после подключения backend.')}
                >
                  Завершить все другие сессии
                </button>
              </div>
            </div>
          </details>
        </div>
      </main>

      <footer className="pf-footer">
        <span>
          <strong>CyberBug</strong> · Центр мониторинга и реагирования на инциденты
        </span>
        <span>Версия платформы 4.8.2</span>
      </footer>
    </div>
  );
}
