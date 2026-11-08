import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  changePassword,
  clearSession,
  getCurrentUser,
  getMe,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
  verifyCurrentEmail,
} from '@api/auth';
import type { CurrentUser, ProfileSession } from '@api/auth';
import AppHeader from '@components/layout/AppHeader';
import AppNav from '@components/layout/AppNav';
import {
  AlternateEmailIcon,
  BadgeIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DevicesIcon,
  EmailReadIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LockIcon,
  LogoutIcon,
  MailIcon,
  PasswordIcon,
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

type FieldErrors = Partial<
  Record<
    | 'profile_name'
    | 'profile_department'
    | 'email_current'
    | 'email_new'
    | 'email_confirm'
    | 'password_current'
    | 'password_new'
    | 'password_repeat',
    string
  >
>;

function maskEmail(value: string | null | undefined): string {
  if (!value) {
    return 'Не задан';
  }
  const [local, domain] = value.split('@');
  if (!domain) {
    return value;
  }
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
}


export default function ProfilePage() {
  const navigate = useNavigate();

  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [user, sessionList] = await Promise.all([getMe(), listSessions()]);
        if (active) {
          setMe(user);
          setSessions(sessionList);
          setDisplayName(user.display_name);
          setDepartment(user.department);
          setEmailVerified(!user.email);
        }
      } catch {
        if (active) {
          const local = getCurrentUser();
          setMe({
            id: '',
            username: local?.username ?? '—',
            role: local?.role ?? 'analyst',
            is_active: true,
            display_name: '',
            department: '',
            email: null,
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
    if (newPassword.length >= 8) {
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

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const errors: FieldErrors = {};
    if (displayName.trim().length > 120) {
      errors.profile_name = 'Не более 120 символов.';
    }
    if (department.trim().length > 120) {
      errors.profile_department = 'Не более 120 символов.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setProfileSaving(true);
    try {
      const updated = await updateProfile({
        display_name: displayName.trim(),
        department: department.trim(),
      });
      setMe(updated);
      setDisplayName(updated.display_name);
      setDepartment(updated.department);
      setNotice('Профиль обновлён.');
    } catch (caught) {
      setFieldErrors({
        profile_name:
          caught instanceof Error ? caught.message : 'Не удалось обновить профиль.',
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleEmailVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const value = currentEmail.trim().toLowerCase();
    if (!value) {
      setFieldErrors({ email_current: 'Введите текущую почту.' });
      return;
    }

    setFieldErrors({});
    setEmailVerifying(true);
    try {
      await verifyCurrentEmail(value);
      setEmailVerified(true);
      setCurrentEmail(value);
    } catch {
      setFieldErrors({ email_current: 'Текущая почта указана неверно.' });
    } finally {
      setEmailVerifying(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const value = newEmail.trim().toLowerCase();
    const confirmation = confirmEmail.trim().toLowerCase();
    const errors: FieldErrors = {};

    if (!value) {
      errors.email_new = 'Введите новый email.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.email_new = 'Некорректный email.';
    }
    if (!confirmation) {
      errors.email_confirm = 'Повторите новый email.';
    } else if (value !== confirmation) {
      errors.email_confirm = 'Адреса не совпадают.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setEmailSaving(true);
    try {
      const updated = await updateProfile({
        email: value,
        current_email: currentEmail.trim() || undefined,
      });
      setMe(updated);
      setCurrentEmail('');
      setNewEmail('');
      setConfirmEmail('');
      setEmailVerified(false);
      setNotice('Адрес электронной почты обновлён.');
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Не удалось обновить email.';
      if (message.includes('already in use')) {
        setFieldErrors({ email_new: 'Этот адрес уже используется.' });
      } else if (message.includes('current email')) {
        setFieldErrors({ email_current: 'Текущая почта указана неверно.' });
      } else {
        setFieldErrors({ email_new: message });
      }
    } finally {
      setEmailSaving(false);
    }
  }

  function cancelEmailChange() {
    setCurrentEmail('');
    setNewEmail('');
    setConfirmEmail('');
    setFieldErrors({});
    setNotice(null);
    if (me?.email) {
      setEmailVerified(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const errors: FieldErrors = {};
    if (!currentPassword) {
      errors.password_current = 'Введите текущий пароль.';
    }
    if (!newPassword) {
      errors.password_new = 'Введите новый пароль.';
    } else if (newPassword.length < 8) {
      errors.password_new = 'Минимум 8 символов.';
    } else if (
      !/[A-Za-zА-Яа-я]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      errors.password_new = 'Используйте хотя бы одну букву и одну цифру.';
    }
    if (repeatPassword !== newPassword) {
      errors.password_repeat = 'Пароли не совпадают.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setPasswordSaving(true);
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setNotice('Пароль изменён.');
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Не удалось сменить пароль.';
      if (message.includes('current password')) {
        setFieldErrors({ password_current: 'Текущий пароль неверен.' });
      } else {
        setFieldErrors({
          password_new:
            message.includes('password must')
              ? 'Пароль должен содержать буквы и цифры.'
              : message,
        });
      }
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleRevokeSession(session: ProfileSession) {
    try {
      await revokeSession(session.id);
      setSessions((previous) => previous.filter((item) => item.id !== session.id));
      setNotice('Сессия завершена.');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Не удалось завершить сессию.');
    }
  }

  async function handleRevokeOthers() {
    try {
      await revokeOtherSessions();
      setSessions((previous) => previous.slice(0, 1));
      setNotice('Другие сессии завершены.');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Не удалось завершить сессии.');
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (    <div className="ws-page pf-page">
      <AppHeader
        onBrandClick={() => navigate('/')}
        sub="Security Ops"
        nav={<AppNav />}
      >
        <div className="pf-user-chip">
          <span className="pf-avatar pf-avatar--small">{initials}</span>
          <span className="pf-user-chip-text">
            <span>{me?.username ?? 'Пользователь'}</span>
            <span>{roleLabel(me?.role)}</span>
          </span>
        </div>
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
                      <strong>{me?.display_name || me?.username || 'Пользователь'}</strong>
                      <span className="pf-mono">@{me?.username ?? 'user'}</span>
                    </div>
                    <p className="pf-profile-role">
                      <VerifiedUserIcon />
                      {accessLabel(me?.role)}
                      {me?.department ? ` · ${me.department}` : ''}
                    </p>
                  </div>
                </div>
                <div className="pf-registered">
                  <span>Дата регистрации:</span>
                  <strong>{formatDate(me?.created_at)}</strong>
                </div>
              </div>

              <form className="pf-form" onSubmit={handleProfileSubmit}>
                <div className="pf-fields">
                  <label
                    className={`pf-field${
                      fieldErrors.profile_name ? ' pf-field--invalid' : ''
                    }`}
                  >
                    <span>Отображаемое имя</span>
                    <div className="pf-input-wrap">
                      <UserIcon className="pf-input-icon" />
                      <input
                        placeholder="Александр Смирнов"
                        value={displayName}
                        aria-invalid={Boolean(fieldErrors.profile_name)}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </div>
                    {fieldErrors.profile_name && (
                      <span className="pf-field-error" role="alert">
                        {fieldErrors.profile_name}
                      </span>
                    )}
                  </label>
                  <label
                    className={`pf-field${
                      fieldErrors.profile_department ? ' pf-field--invalid' : ''
                    }`}
                  >
                    <span>Подразделение</span>
                    <div className="pf-input-wrap">
                      <BadgeIcon className="pf-input-icon" />
                      <input
                        placeholder="SOC Monitoring & Ops"
                        value={department}
                        aria-invalid={Boolean(fieldErrors.profile_department)}
                        onChange={(event) => setDepartment(event.target.value)}
                      />
                    </div>
                    {fieldErrors.profile_department && (
                      <span className="pf-field-error" role="alert">
                        {fieldErrors.profile_department}
                      </span>
                    )}
                  </label>
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
                    {loading
                      ? 'Загрузка данных…'
                      : 'Логин, роль и идентификатор доступны только для чтения.'}
                  </span>
                  <button
                    className="pf-button pf-button--primary"
                    type="submit"
                    disabled={profileSaving || loading}
                  >
                    <SaveIcon />
                    {profileSaving ? 'Сохраняем…' : 'Сохранить профиль'}
                  </button>
                </div>
              </form>
            </div>
          </details>

          <details className="pf-card">
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
              <div className="pf-fields">
                <label className="pf-field">
                  <span>Текущий адрес эл. почты</span>
                  <div className="pf-input-wrap">
                    <LockIcon className="pf-input-icon" />
                    <input value={maskEmail(me?.email)} readOnly disabled />
                  </div>
                  <small>
                    {me?.email
                      ? 'Адрес частично скрыт. Для смены подтвердите его полностью.'
                      : 'Почта не привязана к аккаунту'}
                  </small>
                </label>
              </div>

              {!emailVerified ? (
                <form className="pf-form" onSubmit={handleEmailVerify}>
                  <label
                    className={`pf-field${
                      fieldErrors.email_current ? ' pf-field--invalid' : ''
                    }`}
                  >
                    <span>Подтвердите текущую почту</span>
                    <div className="pf-input-wrap">
                      <MailIcon className="pf-input-icon" />
                      <input
                        type="email"
                        placeholder="Введите текущий адрес полностью"
                        value={currentEmail}
                        aria-invalid={Boolean(fieldErrors.email_current)}
                        onChange={(event) => setCurrentEmail(event.target.value)}
                      />
                    </div>
                    {fieldErrors.email_current && (
                      <span className="pf-field-error" role="alert">
                        {fieldErrors.email_current}
                      </span>
                    )}
                  </label>
                  <div className="pf-form-actions">
                    <button
                      className="pf-button pf-button--primary"
                      type="submit"
                      disabled={emailVerifying}
                    >
                      <MailIcon />
                      {emailVerifying ? 'Проверяем…' : 'Подтвердить почту'}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="pf-form" onSubmit={handleEmailSubmit}>
                  <div className="pf-fields">
                    <label
                      className={`pf-field${
                        fieldErrors.email_new ? ' pf-field--invalid' : ''
                      }`}
                    >
                      <span>Новый адрес эл. почты</span>
                      <div className="pf-input-wrap">
                        <AlternateEmailIcon className="pf-input-icon" />
                        <input
                          type="email"
                          placeholder="analyst.new@enterprise.sec"
                          value={newEmail}
                          aria-invalid={Boolean(fieldErrors.email_new)}
                          onChange={(event) => setNewEmail(event.target.value)}
                        />
                      </div>
                      {fieldErrors.email_new && (
                        <span className="pf-field-error" role="alert">
                          {fieldErrors.email_new}
                        </span>
                      )}
                    </label>
                    <label
                      className={`pf-field${
                        fieldErrors.email_confirm ? ' pf-field--invalid' : ''
                      }`}
                    >
                      <span>Повторите новый email</span>
                      <div className="pf-input-wrap">
                        <MailIcon className="pf-input-icon" />
                        <input
                          type="email"
                          placeholder="analyst.new@enterprise.sec"
                          value={confirmEmail}
                          aria-invalid={Boolean(fieldErrors.email_confirm)}
                          onChange={(event) => setConfirmEmail(event.target.value)}
                        />
                      </div>
                      {fieldErrors.email_confirm && (
                        <span className="pf-field-error" role="alert">
                          {fieldErrors.email_confirm}
                        </span>
                      )}
                    </label>
                  </div>

                  <div className="pf-form-actions">
                    <button
                      className="pf-button pf-button--ghost"
                      type="button"
                      onClick={cancelEmailChange}
                    >
                      Отмена
                    </button>
                    <button
                      className="pf-button pf-button--primary"
                      type="submit"
                      disabled={emailSaving}
                    >
                      <MailIcon />
                      {emailSaving ? 'Сохраняем…' : 'Сохранить email'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </details>

          <details className="pf-card">
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
                <label
                  className={`pf-field${
                    fieldErrors.password_current ? ' pf-field--invalid' : ''
                  }`}
                >
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
                      aria-invalid={Boolean(fieldErrors.password_current)}
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
                  {fieldErrors.password_current && (
                    <span className="pf-field-error" role="alert">
                      {fieldErrors.password_current}
                    </span>
                  )}
                </label>

                <label
                  className={`pf-field${
                    fieldErrors.password_new ? ' pf-field--invalid' : ''
                  }`}
                >
                  <span>Новый пароль</span>
                  <div className="pf-input-wrap">
                    <KeyIcon className="pf-input-icon" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Минимум 8 символов"
                      value={newPassword}
                      aria-invalid={Boolean(fieldErrors.password_new)}
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
                  {fieldErrors.password_new && (
                    <span className="pf-field-error" role="alert">
                      {fieldErrors.password_new}
                    </span>
                  )}
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
                    <span className={newPassword.length >= 8 ? 'pf-hint pf-hint--ok' : 'pf-hint'}>
                      <CheckCircleIcon />
                      Минимум 8 символов
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

                <label
                  className={`pf-field${
                    fieldErrors.password_repeat ? ' pf-field--invalid' : ''
                  }`}
                >
                  <span>Повторите новый пароль</span>
                  <div className="pf-input-wrap">
                    <KeyIcon className="pf-input-icon" />
                    <input
                      type={showRepeatPassword ? 'text' : 'password'}
                      placeholder="Повторите новый пароль"
                      value={repeatPassword}
                      aria-invalid={Boolean(fieldErrors.password_repeat)}
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
                  {fieldErrors.password_repeat && (
                    <span className="pf-field-error" role="alert">
                      {fieldErrors.password_repeat}
                    </span>
                  )}
                  {!fieldErrors.password_repeat &&
                    repeatPassword &&
                    repeatPassword === newPassword && (
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
                      setFieldErrors({});
                      setNotice(null);
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    className="pf-button pf-button--primary"
                    type="submit"
                    disabled={passwordSaving}
                  >
                    <SaveIcon />
                    {passwordSaving ? 'Сохраняем…' : 'Сохранить новый пароль'}
                  </button>
                </div>
              </form>
            </div>
          </details>

          <details className="pf-card">
            <summary className="pf-card-head">
              <span className="pf-card-head-left">
                <span className="pf-card-icon">
                  <DevicesIcon />
                </span>
                <span>
                  <strong>
                    Активные сессии
                    <span className="pf-count">{sessions.length}</span>
                  </strong>
                  <small>Устройства, с которых выполнен вход в ваш аккаунт</small>
                </span>
              </span>
              <ChevronDownIcon className="pf-chevron" />
            </summary>

            <div className="pf-card-body">
              {sessions.map((session, index) => (
                <div className="pf-session" key={session.id}>
                  <div className="pf-session-main">
                    <span className="pf-session-icon">
                      <DevicesIcon />
                    </span>
                    <div>
                      <div className="pf-session-title">
                        Сессия от {formatDate(session.created_at)}
                        {index === 0 && (
                          <span className="pf-session-badge">Текущая</span>
                        )}
                      </div>
                      <div className="pf-session-meta">
                        <span>Действует до {formatDate(session.expires_at)}</span>
                        <span>•</span>
                        <span className="pf-online">
                          {index === 0 ? 'Онлайн сейчас' : 'Активна'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {index === 0 ? (
                    <button
                      className="pf-button pf-button--danger"
                      type="button"
                      onClick={handleLogout}
                    >
                      <LogoutIcon />
                      Выйти
                    </button>
                  ) : (
                    <button
                      className="pf-button pf-button--ghost"
                      type="button"
                      onClick={() => void handleRevokeSession(session)}
                    >
                      Завершить
                    </button>
                  )}
                </div>
              ))}
              {sessions.length === 0 && (
                <p className="pf-readonly-note">Активных сессий не найдено.</p>
              )}

              <div className="pf-form-actions pf-form-actions--between">
                <span className="pf-readonly-note">
                  Завершение других сессий отзывает refresh-токены.
                </span>
                <button
                  className="pf-button pf-button--ghost"
                  type="button"
                  onClick={() => void handleRevokeOthers()}
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
