import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  forgotPassword,
  getCurrentUser,
  getMe,
  getTwoFactorStatus,
  listSessions,
  requestEmailVerification,
  logout,
  revokeOtherSessions,
  revokeSession,
  setupTwoFactor,
  setupTwoFactorDisable,
  updateProfile,
  verifyCurrentEmail,
} from '@api/auth';
import type { CurrentUser, ProfileSession, TwoFactorStatus } from '@api/auth';
import { AppHeader } from '@components';
import {
  AlternateEmailIcon,
  BadgeIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DevicesIcon,
  PhoneIcon,
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
} from '@components/ui';

import { cx } from '@utils/cx';
import { useToast } from '@context/toast';

import workspaceStyles from '@components/workspace/workspace.module.css';
import profileStyles from './ProfilePage.module.css';

const styles = { ...workspaceStyles, ...profileStyles };

const roleLabel = (role: string | undefined): string =>
  role === 'admin' ? 'Администратор' : 'Пользователь';

const accessLabel = (role: string | undefined): string =>
  role === 'admin'
    ? 'Администратор (полный доступ)'
    : 'Пользователь (без доступа к админке)';

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

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function deviceLabel(userAgent: string): string {
  const value = userAgent.toLowerCase();
  if (/ipad|tablet/.test(value)) {
    return 'Планшет';
  }
  if (/iphone|android|mobile/.test(value)) {
    return 'Телефон';
  }
  return 'Компьютер';
}

function browserLabel(userAgent: string): string {
  const value = userAgent.toLowerCase();
  if (value.includes('yabrowser')) {
    return 'Яндекс.Браузер';
  }
  if (value.includes('edg/')) {
    return 'Edge';
  }
  if (value.includes('opr/') || value.includes('opera')) {
    return 'Opera';
  }
  if (value.includes('firefox')) {
    return 'Firefox';
  }
  if (value.includes('chrome')) {
    return 'Chrome';
  }
  if (value.includes('safari')) {
    return 'Safari';
  }
  return 'Неизвестный браузер';
}

type FieldErrors = Partial<
  Record<
    | 'profile_name'
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

  const [verificationSending, setVerificationSending] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const { pushToast } = useToast();
  const [twoFactor, setTwoFactor] = useState<TwoFactorStatus | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorStage, setTwoFactorStage] = useState<'idle' | 'code' | 'disable'>('idle');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
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
        const [user, sessionList] = await Promise.all([
          getMe(),
          listSessions(),
        ]);
        if (active) {
          setMe(user);
          setSessions(sessionList);
          setDisplayName(user.display_name);
          setEmailVerified(!user.email);
        }
      } catch {
        if (active) {
          const local = getCurrentUser();
          setMe({
            id: '',
            username: local?.username ?? '—',
            role: local?.role ?? 'user',
            is_active: true,
            display_name: '',
            email: null,
            email_verified_at: null,
            two_factor_enabled: false,
            created_at: '',
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    void getTwoFactorStatus()
      .then((status) => {
        if (active) {
          setTwoFactor(status);
        }
      })
      .catch(() => {
        if (active) {
          setTwoFactor(null);
        }
      });

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

    const errors: FieldErrors = {};
    if (displayName.trim().length > 120) {
      errors.profile_name = 'Не более 120 символов.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setProfileSaving(true);
    try {
      const updated = await updateProfile({
        display_name: displayName.trim(),
      });
      setMe(updated);
      setDisplayName(updated.display_name);
      pushToast('success', 'Профиль обновлён.');
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
      pushToast('success', 'Адрес электронной почты обновлён.');
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Не удалось обновить email.';
      if (message.includes('already in use')) {
        setFieldErrors({ email_new: 'Этот адрес уже используется.' });
      } else if (message.includes('current email')) {
        setFieldErrors({ email_current: 'Текущая почта указана неверно.' });
        setEmailVerified(false);
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
    if (me?.email) {
      setEmailVerified(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
      pushToast('success', 'Пароль изменён.');
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Не удалось сменить пароль.';
      if (message.includes('current password')) {
        setFieldErrors({ password_current: 'Текущий пароль неверен.' });
      } else {
        setFieldErrors({
          password_new: message.includes('at least 8')
            ? 'Минимум 8 символов.'
            : message.includes('letter')
              ? 'Используйте хотя бы одну букву и одну цифру.'
              : message,
        });
      }
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleForgotPassword() {
    if (!me?.email) {
      pushToast('error', 'К аккаунту не привязана почта.');
      return;
    }
    setResetSending(true);
    try {
      await forgotPassword(me.email);
      pushToast(
        'success',
        `Ссылка для сброса пароля отправлена на ${maskEmail(me.email)}.`,
      );
    } catch (caught) {
      pushToast(
        'error',
        caught instanceof Error ? caught.message : 'Не удалось отправить письмо.',
      );
    } finally {
      setResetSending(false);
    }
  }

  async function handleTwoFactorToggle() {
    if (!twoFactor || twoFactorBusy) {
      return;
    }
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      if (twoFactor.enabled) {
        await setupTwoFactorDisable();
        setTwoFactorStage('disable');
        pushToast('info', 'Код для отключения отправлен на почту.');
      } else {
        await setupTwoFactor();
        setTwoFactorStage('code');
        pushToast('info', 'Код подтверждения отправлен на почту.');
      }
    } catch (caught) {
      setTwoFactorError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось изменить настройку 2FA.',
      );
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleTwoFactorConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!twoFactorCode.trim()) {
      setTwoFactorError('Введите код из письма.');
      return;
    }
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    try {
      const disabling = twoFactorStage === 'disable';
      if (disabling) {
        await disableTwoFactor(twoFactorCode.trim());
      } else {
        await enableTwoFactor(twoFactorCode.trim());
      }
      setTwoFactor((current) => (current ? { ...current, enabled: !disabling } : current));
      setMe((current) =>
        current ? { ...current, two_factor_enabled: !disabling } : current,
      );
      setTwoFactorStage('idle');
      setTwoFactorCode('');
      pushToast(
        'success',
        disabling
          ? 'Двухфакторная аутентификация отключена.'
          : 'Двухфакторная аутентификация включена.',
      );
    } catch (caught) {
      setTwoFactorError(
        caught instanceof Error ? caught.message : 'Неверный или просроченный код.',
      );
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleRevokeSession(session: ProfileSession) {
    try {
      await revokeSession(session.id);
      setSessions((previous) => previous.filter((item) => item.id !== session.id));
      pushToast('success', 'Сессия завершена.');
    } catch (caught) {
      pushToast(
        'error',
        caught instanceof Error ? caught.message : 'Не удалось завершить сессию.',
      );
    }
  }

  async function handleRevokeOthers() {
    try {
      await revokeOtherSessions();
      setSessions((previous) => previous.slice(0, 1));
      pushToast('success', 'Другие сессии завершены.');
    } catch (caught) {
      pushToast(
        'error',
        caught instanceof Error ? caught.message : 'Не удалось завершить сессии.',
      );
    }
  }

  async function handleResendVerification() {
    setVerificationSending(true);
    setVerificationNotice(null);
    try {
      await requestEmailVerification();
      setVerificationNotice('Ссылка отправлена. Проверьте почту и папку «Спам».');
    } catch (caught) {
      setVerificationNotice(
        caught instanceof Error ? caught.message : 'Не удалось отправить письмо.',
      );
    } finally {
      setVerificationSending(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const passwordMismatch = repeatPassword.length > 0 && repeatPassword !== newPassword;

  return (    <div className={cx(styles, "ws-page pf-page")}>
      <AppHeader sub="Security Ops" />

      <main className={cx(styles, "pf-main")}>
        <div className={cx(styles, "pf-breadcrumbs")}>
          <span>CyberBug</span>
          <span>/</span>
          <span>Настройки учетной записи</span>
        </div>
        <h1 className={cx(styles, "pf-title")}>Профиль пользователя</h1>
        <p className={cx(styles, "pf-subtitle")}>
          Управление персональными данными, контактным email, паролем и текущими сессиями
          в системе.
        </p>

        {me?.email && !me.email_verified_at && (
          <div className={cx(styles, "pf-verify-banner")} role="status">
            <EmailReadIcon />
            <div>
              <strong>Почта не подтверждена</strong>
              <span>
                Подтвердите {me.email}, чтобы использовать восстановление пароля.
              </span>
              {verificationNotice && <small>{verificationNotice}</small>}
            </div>
            <button
              className={cx(styles, "pf-button pf-button--primary")}
              type="button"
              disabled={verificationSending}
              onClick={() => void handleResendVerification()}
            >
              {verificationSending ? 'Отправляем…' : 'Отправить ссылку'}
            </button>
          </div>
        )}

        <div className={cx(styles, "pf-cards")}>
          <details className={cx(styles, "pf-card")} open>
            <summary className={cx(styles, "pf-card-head")}>
              <span className={cx(styles, "pf-card-head-left")}>
                <span className={cx(styles, "pf-card-icon")}>
                  <BadgeIcon />
                </span>
                <span>
                  <strong>Информация о пользователе</strong>
                  <small>Личные данные и служебная информация аккаунта</small>
                </span>
              </span>
              <ChevronDownIcon className={cx(styles, "pf-chevron")} />
            </summary>

            <div className={cx(styles, "pf-card-body")}>
              <div className={cx(styles, "pf-profile-strip")}>
                <div className={cx(styles, "pf-profile-main")}>
                  <span className={cx(styles, "pf-avatar")}>{initials}</span>
                  <div>
                    <div className={cx(styles, "pf-profile-name-row")}>
                      <strong>{me?.display_name || me?.username || 'Пользователь'}</strong>
                      <span className={cx(styles, "pf-mono")}>@{me?.username ?? 'user'}</span>
                    </div>
                    <p className={cx(styles, "pf-profile-role")}>
                      <VerifiedUserIcon />
                      {accessLabel(me?.role)}
                    </p>
                  </div>
                </div>
                <div className={cx(styles, "pf-registered")}>
                  <span>Дата регистрации:</span>
                  <strong>{formatDate(me?.created_at)}</strong>
                </div>
              </div>

              <form className={cx(styles, "pf-form")} onSubmit={handleProfileSubmit}>
                <div className={cx(styles, "pf-fields")}>
                  <label
                    className={cx(styles, `pf-field${
                      fieldErrors.profile_name ? ' pf-field--invalid' : ''
                    }`)}
                  >
                    <span>Отображаемое имя</span>
                    <div className={cx(styles, "pf-input-wrap")}>
                      <UserIcon className={cx(styles, "pf-input-icon")} />
                      <input
                        placeholder="Александр Смирнов"
                        value={displayName}
                        aria-invalid={Boolean(fieldErrors.profile_name)}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </div>
                    {fieldErrors.profile_name && (
                      <span className={cx(styles, "pf-field-error")} role="alert">
                        {fieldErrors.profile_name}
                      </span>
                    )}
                  </label>
                  <label className={cx(styles, "pf-field")}>
                    <span>Логин</span>
                    <input value={me?.username ?? ''} readOnly disabled />
                  </label>
                  <label className={cx(styles, "pf-field")}>
                    <span>Роль</span>
                    <input value={roleLabel(me?.role)} readOnly disabled />
                  </label>
                  <label className={cx(styles, "pf-field")}>
                    <span>Статус аккаунта</span>
                    <input value={me?.is_active ? 'Активен' : 'Отключён'} readOnly disabled />
                  </label>
                  <label className={cx(styles, "pf-field")}>
                    <span>Идентификатор</span>
                    <input value={me?.id || '—'} readOnly disabled />
                  </label>
                </div>

                <div className={cx(styles, "pf-form-actions")}>
                  <span className={cx(styles, "pf-readonly-note")}>
                    {loading
                      ? 'Загрузка данных…'
                      : 'Логин, роль и идентификатор доступны только для чтения.'}
                  </span>
                  <button
                    className={cx(styles, "pf-button pf-button--primary")}
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

          <details className={cx(styles, "pf-card")}>
            <summary className={cx(styles, "pf-card-head")}>
              <span className={cx(styles, "pf-card-head-left")}>
                <span className={cx(styles, "pf-card-icon")}>
                  <EmailReadIcon />
                </span>
                <span>
                  <strong>Смена адреса электронной почты</strong>
                  <small>Обновление основного контактного адреса профиля</small>
                </span>
              </span>
              <ChevronDownIcon className={cx(styles, "pf-chevron")} />
            </summary>

            <div className={cx(styles, "pf-card-body")}>
              <div className={cx(styles, "pf-fields")}>
                <label className={cx(styles, "pf-field")}>
                  <span>Текущий адрес эл. почты</span>
                  <div className={cx(styles, "pf-input-wrap")}>
                    <LockIcon className={cx(styles, "pf-input-icon")} />
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
                <form className={cx(styles, "pf-form")} onSubmit={handleEmailVerify}>
                  <label
                    className={cx(styles, `pf-field${
                      fieldErrors.email_current ? ' pf-field--invalid' : ''
                    }`)}
                  >
                    <span>Подтвердите текущую почту</span>
                    <div className={cx(styles, "pf-input-wrap")}>
                      <MailIcon className={cx(styles, "pf-input-icon")} />
                      <input
                        type="email"
                        placeholder="Введите текущий адрес полностью"
                        value={currentEmail}
                        aria-invalid={Boolean(fieldErrors.email_current)}
                        onChange={(event) => setCurrentEmail(event.target.value)}
                      />
                    </div>
                    {fieldErrors.email_current && (
                      <span className={cx(styles, "pf-field-error")} role="alert">
                        {fieldErrors.email_current}
                      </span>
                    )}
                  </label>
                  <div className={cx(styles, "pf-form-actions")}>
                    <button
                      className={cx(styles, "pf-button pf-button--primary")}
                      type="submit"
                      disabled={emailVerifying}
                    >
                      <MailIcon />
                      {emailVerifying ? 'Проверяем…' : 'Подтвердить почту'}
                    </button>
                  </div>
                </form>
              ) : (
                <form className={cx(styles, "pf-form")} onSubmit={handleEmailSubmit}>
                  <div className={cx(styles, "pf-fields")}>
                    <label
                      className={cx(styles, `pf-field${
                        fieldErrors.email_new ? ' pf-field--invalid' : ''
                      }`)}
                    >
                      <span>Новый адрес эл. почты</span>
                      <div className={cx(styles, "pf-input-wrap")}>
                        <AlternateEmailIcon className={cx(styles, "pf-input-icon")} />
                        <input
                          type="email"
                          placeholder="user.new@enterprise.sec"
                          value={newEmail}
                          aria-invalid={Boolean(fieldErrors.email_new)}
                          onChange={(event) => setNewEmail(event.target.value)}
                        />
                      </div>
                      {fieldErrors.email_new && (
                        <span className={cx(styles, "pf-field-error")} role="alert">
                          {fieldErrors.email_new}
                        </span>
                      )}
                    </label>
                    <label
                      className={cx(styles, `pf-field${
                        fieldErrors.email_confirm ? ' pf-field--invalid' : ''
                      }`)}
                    >
                      <span>Повторите новый email</span>
                      <div className={cx(styles, "pf-input-wrap")}>
                        <MailIcon className={cx(styles, "pf-input-icon")} />
                        <input
                          type="email"
                          placeholder="user.new@enterprise.sec"
                          value={confirmEmail}
                          aria-invalid={Boolean(fieldErrors.email_confirm)}
                          onChange={(event) => setConfirmEmail(event.target.value)}
                        />
                      </div>
                      {fieldErrors.email_confirm && (
                        <span className={cx(styles, "pf-field-error")} role="alert">
                          {fieldErrors.email_confirm}
                        </span>
                      )}
                    </label>
                  </div>

                  <div className={cx(styles, "pf-form-actions")}>
                    <button
                      className={cx(styles, "pf-button pf-button--ghost")}
                      type="button"
                      onClick={cancelEmailChange}
                    >
                      Отмена
                    </button>
                    <button
                      className={cx(styles, "pf-button pf-button--primary")}
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

          {twoFactor?.available && (
            <details className={cx(styles, "pf-card")}>
              <summary className={cx(styles, "pf-card-head")}>
                <span className={cx(styles, "pf-card-head-left")}>
                  <span className={cx(styles, "pf-card-icon")}>
                    <VerifiedUserIcon />
                  </span>
                  <span>
                    <strong>Двухфакторная аутентификация</strong>
                    <small>Код подтверждения на почту после ввода пароля</small>
                  </span>
                </span>
                <ChevronDownIcon className={cx(styles, "pf-chevron")} />
              </summary>

              <div className={cx(styles, "pf-card-body")}>
                <div className={cx(styles, "pf-2fa-toggle")}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={twoFactor.enabled}
                    aria-label="Запрашивать код при входе"
                    className={cx(
                      styles,
                      `pf-switch${twoFactor.enabled ? ' pf-switch--on' : ''}`,
                    )}
                    disabled={
                      !twoFactor.email_verified ||
                      twoFactorBusy ||
                      twoFactorStage !== 'idle'
                    }
                    onClick={() => void handleTwoFactorToggle()}
                  >
                    <span className={cx(styles, "pf-switch-thumb")} />
                  </button>
                  <span>
                    <strong>Запрашивать код при входе</strong>
                    <small>
                      {twoFactor.enabled
                        ? 'Включена. После пароля потребуется код из письма.'
                        : 'Выключена. Вход выполняется только по паролю.'}
                    </small>
                  </span>
                </div>

                {!twoFactor.email_verified && (
                  <p className={cx(styles, "pf-readonly-note")}>
                    Сначала подтвердите адрес электронной почты — код 2FA отправляется
                    на него.
                  </p>
                )}

                {twoFactorStage !== 'idle' && (
                  <form
                    className={cx(styles, "pf-form")}
                    onSubmit={handleTwoFactorConfirm}
                  >
                    <label className={cx(styles, "pf-field")}>
                      <span>Код из письма</span>
                      <div className={cx(styles, "pf-input-wrap")}>
                        <LockIcon className={cx(styles, "pf-input-icon")} />
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="6 цифр"
                          value={twoFactorCode}
                          onChange={(event) => setTwoFactorCode(event.target.value)}
                        />
                      </div>
                    </label>
                    <div className={cx(styles, "pf-form-actions")}>
                      <button
                        className={cx(styles, "pf-button pf-button--ghost")}
                        type="button"
                        onClick={() => {
                          setTwoFactorStage('idle');
                          setTwoFactorCode('');
                          setTwoFactorError(null);
                        }}
                      >
                        Отмена
                      </button>
                      <button
                        className={cx(styles, "pf-button pf-button--primary")}
                        type="submit"
                        disabled={twoFactorBusy}
                      >
                        <VerifiedUserIcon />
                        {twoFactorBusy
                          ? 'Проверяем…'
                          : twoFactorStage === 'disable'
                            ? 'Подтвердить отключение'
                            : 'Подтвердить включение'}
                      </button>
                    </div>
                  </form>
                )}

                {twoFactorError && (
                  <p className={cx(styles, "pf-field-error")} role="alert">
                    {twoFactorError}
                  </p>
                )}
              </div>
            </details>
          )}

          <details className={cx(styles, "pf-card")}>
            <summary className={cx(styles, "pf-card-head")}>
              <span className={cx(styles, "pf-card-head-left")}>
                <span className={cx(styles, "pf-card-icon")}>
                  <PasswordIcon />
                </span>
                <span>
                  <strong>Изменение пароля</strong>
                  <small>Регулярная смена пароля повышает безопасность аккаунта</small>
                </span>
              </span>
              <ChevronDownIcon className={cx(styles, "pf-chevron")} />
            </summary>

            <div className={cx(styles, "pf-card-body")}>
              <form className={cx(styles, "pf-form")} onSubmit={handlePasswordSubmit}>
                <label
                  className={cx(styles, `pf-field${
                    fieldErrors.password_current ? ' pf-field--invalid' : ''
                  }`)}
                >
                  <span className={cx(styles, "pf-label-row")}>
                    Текущий пароль
                    <button
                      className={cx(styles, "pf-link")}
                      type="button"
                      disabled={resetSending}
                      onClick={() => void handleForgotPassword()}
                    >
                      {resetSending ? 'Отправляем…' : 'Забыли пароль?'}
                    </button>
                  </span>
                  <div className={cx(styles, "pf-input-wrap")}>
                    <KeyIcon className={cx(styles, "pf-input-icon")} />
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      placeholder="Введите текущий пароль"
                      value={currentPassword}
                      aria-invalid={Boolean(fieldErrors.password_current)}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                    <button
                      className={cx(styles, "pf-eye")}
                      type="button"
                      aria-label={showCurrentPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowCurrentPassword((value) => !value)}
                    >
                      {showCurrentPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {fieldErrors.password_current && (
                    <span className={cx(styles, "pf-field-error")} role="alert">
                      {fieldErrors.password_current}
                    </span>
                  )}
                </label>

                <label
                  className={cx(styles, `pf-field${
                    fieldErrors.password_new ? ' pf-field--invalid' : ''
                  }`)}
                >
                  <span>Новый пароль</span>
                  <div className={cx(styles, "pf-input-wrap")}>
                    <KeyIcon className={cx(styles, "pf-input-icon")} />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Минимум 8 символов"
                      value={newPassword}
                      aria-invalid={Boolean(fieldErrors.password_new)}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <button
                      className={cx(styles, "pf-eye")}
                      type="button"
                      aria-label={showNewPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowNewPassword((value) => !value)}
                    >
                      {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {fieldErrors.password_new && (
                    <span className={cx(styles, "pf-field-error")} role="alert">
                      {fieldErrors.password_new}
                    </span>
                  )}
                </label>

                <div className={cx(styles, "pf-strength")}>
                  <div className={cx(styles, "pf-strength-head")}>
                    <span>Сложность пароля</span>
                    <strong>{passwordStrength === 3 ? 'Надёжный' : passwordStrength === 2 ? 'Средний' : 'Слабый'}</strong>
                  </div>
                  <div className={cx(styles, "pf-strength-bar")}>
                    {[0, 1, 2].map((index) => (
                      <span
                        className={cx(styles, index < passwordStrength ? 'pf-strength-segment pf-strength-segment--on' : 'pf-strength-segment')}
                        key={index}
                      />
                    ))}
                  </div>
                  <div className={cx(styles, "pf-strength-hints")}>
                    <span className={cx(styles, newPassword.length >= 8 ? 'pf-hint pf-hint--ok' : 'pf-hint')}>
                      <CheckCircleIcon />
                      Минимум 8 символов
                    </span>
                    <span className={cx(styles, /[A-ZА-Я]/.test(newPassword) && /[a-zа-я]/.test(newPassword) ? 'pf-hint pf-hint--ok' : 'pf-hint')}>
                      <CheckCircleIcon />
                      Заглавные и строчные буквы
                    </span>
                    <span className={cx(styles, /\d/.test(newPassword) && /[^A-Za-zА-Яа-я0-9]/.test(newPassword) ? 'pf-hint pf-hint--ok' : 'pf-hint')}>
                      <CheckCircleIcon />
                      Цифры и спецсимволы (!@#$)
                    </span>
                  </div>
                </div>

                <label
                  className={cx(styles, `pf-field${
                    fieldErrors.password_repeat || passwordMismatch
                      ? ' pf-field--invalid'
                      : ''
                  }`)}
                >
                  <span>Повторите новый пароль</span>
                  <div className={cx(styles, "pf-input-wrap")}>
                    <KeyIcon className={cx(styles, "pf-input-icon")} />
                    <input
                      type={showRepeatPassword ? 'text' : 'password'}
                      placeholder="Повторите новый пароль"
                      value={repeatPassword}
                      aria-invalid={Boolean(fieldErrors.password_repeat)}
                      onChange={(event) => setRepeatPassword(event.target.value)}
                    />
                    <button
                      className={cx(styles, "pf-eye")}
                      type="button"
                      aria-label={showRepeatPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowRepeatPassword((value) => !value)}
                    >
                      {showRepeatPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {(fieldErrors.password_repeat || passwordMismatch) && (
                    <span className={cx(styles, "pf-field-error")} role="alert">
                      Пароли не совпадают.
                    </span>
                  )}
                  {!fieldErrors.password_repeat &&
                    !passwordMismatch &&
                    repeatPassword &&
                    repeatPassword === newPassword && (
                      <small className={cx(styles, "pf-match")}>
                        <CheckCircleIcon />
                        Пароли совпадают
                      </small>
                    )}
                </label>

                <div className={cx(styles, "pf-form-actions")}>
                  <button
                    className={cx(styles, "pf-button pf-button--ghost")}
                    type="button"
                    onClick={() => {
                      setCurrentPassword('');
                      setNewPassword('');
                      setRepeatPassword('');
                      setFieldErrors({});
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    className={cx(styles, "pf-button pf-button--primary")}
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

          <details className={cx(styles, "pf-card")}>
            <summary className={cx(styles, "pf-card-head")}>
              <span className={cx(styles, "pf-card-head-left")}>
                <span className={cx(styles, "pf-card-icon")}>
                  <DevicesIcon />
                </span>
                <span>
                  <strong>
                    Активные сессии
                    <span className={cx(styles, "pf-count")}>{sessions.length}</span>
                  </strong>
                  <small>Устройства, с которых выполнен вход в ваш аккаунт</small>
                </span>
              </span>
              <ChevronDownIcon className={cx(styles, "pf-chevron")} />
            </summary>

            <div className={cx(styles, "pf-card-body")}>
              {sessions.map((session, index) => (
                <div className={cx(styles, "pf-session")} key={session.id}>
                  <div className={cx(styles, "pf-session-main")}>
                    <span
                      className={cx(styles, "pf-session-icon")}
                      title={deviceLabel(session.user_agent)}
                      aria-label={deviceLabel(session.user_agent)}
                    >
                      {/ipad|tablet|iphone|android|mobile/.test(
                        session.user_agent.toLowerCase(),
                      ) ? (
                        <PhoneIcon />
                      ) : (
                        <DevicesIcon />
                      )}
                    </span>
                    <div>
                      <div className={cx(styles, "pf-session-title")}>
                        Сессия от {formatDate(session.created_at)}
                        {index === 0 && (
                          <span className={cx(styles, "pf-session-badge")}>Текущая</span>
                        )}
                      </div>
                      <div className={cx(styles, "pf-session-meta")}>
                        <span>{browserLabel(session.user_agent)}</span>
                        <span>•</span>
                        <span>IP: {session.ip || '—'}</span>
                      </div>
                      <div className={cx(styles, "pf-session-meta")}>
                        <span>Активность: {formatDateTime(session.last_seen_at)}</span>
                        <span>•</span>
                        <span>Действует до {formatDate(session.expires_at)}</span>
                        <span>•</span>
                        <span className={cx(styles, "pf-online")}>
                          {index === 0 ? 'Онлайн сейчас' : 'Активна'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {index === 0 ? (
                    <button
                      className={cx(styles, "pf-button pf-button--danger")}
                      type="button"
                      onClick={() => void handleLogout()}
                    >
                      <LogoutIcon />
                      Выйти
                    </button>
                  ) : (
                    <button
                      className={cx(styles, "pf-button pf-button--ghost")}
                      type="button"
                      onClick={() => void handleRevokeSession(session)}
                    >
                      Завершить
                    </button>
                  )}
                </div>
              ))}
              {sessions.length === 0 && (
                <p className={cx(styles, "pf-readonly-note")}>Активных сессий не найдено.</p>
              )}

              <div className={cx(styles, "pf-form-actions pf-form-actions--between")}>
                <span className={cx(styles, "pf-readonly-note")}>
                  Завершение других сессий отзывает refresh-токены.
                </span>
                <button
                  className={cx(styles, "pf-button pf-button--ghost")}
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

      <footer className={cx(styles, "pf-footer")}>
        <span>
          <strong>CyberBug</strong> · Центр мониторинга и реагирования на инциденты
        </span>
        <span>Версия платформы 4.8.2</span>
      </footer>
    </div>
  );
}
