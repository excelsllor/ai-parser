import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { login, register, saveSession, startOAuth, fetchAuthProviders } from '@api/auth';
import { ApiError } from '@api/http';
import vkLogo from '@assets/providers/vk.svg';
import yandexButton from '@assets/providers/yandex-button-content.svg';
import {
  AlertCircleIcon,
  AlternateEmailIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  SparklesIcon,
} from '@components/ui';
import { AppHeader } from '@components';

import { cx } from '@utils/cx';

import authStyles from './AuthPage.module.css';

const styles = authStyles;

type Tab = 'login' | 'register';
type OAuthProvider = 'yandex' | 'vk';

interface ProviderAvailability {
  yandex: boolean;
  vk: boolean;
}

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const tab: Tab = location.pathname === '/register' ? 'register' : 'login';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [providers, setProviders] = useState<ProviderAvailability | null>(null);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const authPanelRef = useRef<HTMLDivElement>(null);
  const previousPanelHeight = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    void fetchAuthProviders()
      .then((availability) => {
        if (active) {
          setProviders(availability);
        }
      })
      .catch(() => {
        if (active) {
          setProviders({ yandex: false, vk: false });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useLayoutEffect(() => {
    const panel = authPanelRef.current;
    const from = previousPanelHeight.current;
    previousPanelHeight.current = null;

    if (!panel || from === null) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const to = panel.offsetHeight;
    if (Math.abs(to - from) < 1) {
      return;
    }

    panel.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [tab]);

  function switchTab(next: Tab) {
    if (next === tab) {
      return;
    }
    previousPanelHeight.current = authPanelRef.current?.offsetHeight ?? null;
    setError(null);
    setNotice(null);
    navigate(next === 'register' ? '/register' : '/login');
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!username.trim() || !password) {
      setError('Введите логин и пароль.');
      return;
    }

    setLoading(true);
    try {
      const session = await login(username.trim(), password);
      saveSession(session, remember);
      navigate('/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(
          caught.status === 401
            ? 'Неверный логин или пароль.'
            : caught.message,
        );
      } else {
        setError('Не удалось войти. Проверьте соединение с сервером.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!username.trim() || !password || !confirmPassword) {
      setError('Заполните все поля.');
      return;
    }
    if (username.trim().length < 3) {
      setError('Имя пользователя должно содержать не менее 3 символов.');
      return;
    }
    if (password.length < 10) {
      setError('Пароль должен содержать не менее 10 символов.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }
    if (!termsAccepted) {
      setError('Подтвердите согласие с условиями использования.');
      return;
    }

    setLoading(true);
    try {
      const session = await register(username.trim(), password, email.trim() || undefined);
      saveSession(session, remember);
      navigate('/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(
          caught.status === 409
            ? 'Пользователь с таким именем уже существует.'
            : caught.message,
        );
      } else {
        setError('Не удалось создать аккаунт. Проверьте соединение с сервером.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setNotice(null);
    setOauthLoading(provider);

    try {
      const url = await startOAuth(provider);
      window.location.assign(url);
    } catch (caught) {
      setOauthLoading(null);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось начать вход через внешний сервис.',
      );
    }
  }

  return (
    <div className={cx(styles, "auth-page")}>
      <AppHeader />

      <main className={cx(styles, "auth-main")}>
        <div className={cx(styles, "auth-wrap")}>
          <section className={cx(styles, "auth-card")} aria-labelledby="auth-title">
            <div className={cx(styles, "auth-card-head")}>
              <div className={cx(styles, "auth-logo")}>
                <img src="/icons/logo.svg" alt="" />
              </div>
              <h1 className={cx(styles, "auth-title")} id="auth-title">
                CyberBug
              </h1>
              <span className={cx(styles, "auth-badge")}>
                <SparklesIcon />
                Платформа ИИ-мониторинга угроз
              </span>
            </div>

            <div
              className={cx(styles, "auth-tabs")}
              role="tablist"
              aria-label="Авторизация"
              data-tab={tab}
            >
              <span className={cx(styles, "auth-tab-indicator")} aria-hidden="true" />
              <button
                className={cx(styles, `auth-tab${tab === 'login' ? ' auth-tab--active' : ''}`)}
                type="button"
                role="tab"
                aria-selected={tab === 'login'}
                onClick={() => switchTab('login')}
              >
                Вход
              </button>
              <button
                className={cx(styles, `auth-tab${tab === 'register' ? ' auth-tab--active' : ''}`)}
                type="button"
                role="tab"
                aria-selected={tab === 'register'}
                onClick={() => switchTab('register')}
              >
                Регистрация
              </button>
            </div>

            {error && (
              <div className={cx(styles, "auth-alert auth-alert--error")} role="alert">
                <AlertCircleIcon />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className={cx(styles, "auth-alert auth-alert--info")} role="status">
                <InfoIcon />
                <span>{notice}</span>
              </div>
            )}

            <div className={cx(styles, "auth-panel")} ref={authPanelRef}>
              {tab === 'login' ? (
                <form className={cx(styles, "auth-form")} onSubmit={handleLogin} noValidate>
                <div className={cx(styles, "auth-field")}>
                  <label className={cx(styles, "auth-label")} htmlFor="login-username">
                    Email или логин
                  </label>
                  <div className={cx(styles, "auth-control")}>
                    <span className={cx(styles, "auth-control-icon")}>
                      <MailIcon />
                    </span>
                    <input
                      className={cx(styles, "auth-input")}
                      id="login-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      placeholder="name@company.com"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>
                </div>

                <div className={cx(styles, "auth-field")}>
                  <label className={cx(styles, "auth-label")} htmlFor="login-password">
                    Пароль
                  </label>
                  <div className={cx(styles, "auth-control")}>
                    <span className={cx(styles, "auth-control-icon")}>
                      <LockIcon />
                    </span>
                    <input
                      className={cx(styles, "auth-input auth-input--password")}
                      id="login-password"
                      name="password"
                      type={showLoginPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Введите пароль"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      className={cx(styles, "auth-password-toggle")}
                      type="button"
                      aria-label={showLoginPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowLoginPassword((value) => !value)}
                    >
                      {showLoginPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <div className={cx(styles, "auth-options")}>
                  <label className={cx(styles, "auth-checkbox-label")}>
                    <input
                      className={cx(styles, "auth-checkbox")}
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                    />
                    Запомнить меня
                  </label>
                  <button
                    className={cx(styles, "auth-link")}
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                  >
                    Забыли пароль?
                  </button>
                </div>

                <button className={cx(styles, "auth-submit")} type="submit" disabled={loading}>
                  <span>{loading ? 'Входим…' : 'Войти в систему'}</span>
                  <ArrowRightIcon className={cx(styles, "auth-submit-icon")} />
                </button>
              </form>
            ) : (
              <form className={cx(styles, "auth-form")} onSubmit={handleRegister} noValidate>
                <div className={cx(styles, "auth-field")}>
                  <label className={cx(styles, "auth-label")} htmlFor="register-username">
                    Имя пользователя
                  </label>
                  <div className={cx(styles, "auth-control")}>
                    <span className={cx(styles, "auth-control-icon")}>
                      <MailIcon />
                    </span>
                    <input
                      className={cx(styles, "auth-input")}
                      id="register-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      placeholder="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>
                </div>

                <div className={cx(styles, "auth-field")}>
                  <label className={cx(styles, "auth-label")} htmlFor="register-email">
                    Email для восстановления пароля
                  </label>
                  <div className={cx(styles, "auth-control")}>
                    <span className={cx(styles, "auth-control-icon")}>
                      <AlternateEmailIcon />
                    </span>
                    <input
                      className={cx(styles, "auth-input")}
                      id="register-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                </div>

                <div className={cx(styles, "auth-field")}>
                  <label className={cx(styles, "auth-label")} htmlFor="register-password">
                    Пароль
                  </label>
                  <div className={cx(styles, "auth-control")}>
                    <span className={cx(styles, "auth-control-icon")}>
                      <LockIcon />
                    </span>
                    <input
                      className={cx(styles, "auth-input auth-input--password")}
                      id="register-password"
                      name="new-password"
                      type={showRegisterPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Создайте надёжный пароль"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      className={cx(styles, "auth-password-toggle")}
                      type="button"
                      aria-label={showRegisterPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowRegisterPassword((value) => !value)}
                    >
                      {showRegisterPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <div className={cx(styles, "auth-field")}>
                  <label className={cx(styles, "auth-label")} htmlFor="register-confirm">
                    Подтверждение пароля
                  </label>
                  <div className={cx(styles, "auth-control")}>
                    <span className={cx(styles, "auth-control-icon")}>
                      <LockIcon />
                    </span>
                    <input
                      className={cx(styles, "auth-input auth-input--password")}
                      id="register-confirm"
                      name="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Повторите пароль"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <button
                      className={cx(styles, "auth-password-toggle")}
                      type="button"
                      aria-label={showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowConfirmPassword((value) => !value)}
                    >
                      {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <div className={cx(styles, "auth-terms")}>
                  <label className={cx(styles, "auth-checkbox-label auth-checkbox-label--terms")}>
                    <input
                      className={cx(styles, "auth-checkbox")}
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                    />
                    <span>
                      Я согласен с{' '}
                      <button
                        className={cx(styles, "auth-link")}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setNotice('Условия использования будут опубликованы позже.');
                        }}
                      >
                        условиями использования
                      </button>{' '}
                      и{' '}
                      <button
                        className={cx(styles, "auth-link")}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setNotice('Политика конфиденциальности будет опубликована позже.');
                        }}
                      >
                        политикой конфиденциальности
                      </button>
                    </span>
                  </label>
                </div>

                <button className={cx(styles, "auth-submit")} type="submit" disabled={loading}>
                  <span>{loading ? 'Создаём…' : 'Создать аккаунт'}</span>
                  <ArrowRightIcon className={cx(styles, "auth-submit-icon")} />
                </button>
                </form>
              )}
            </div>

            <div className={cx(styles, "auth-divider")}>
              <span>
                {tab === 'login' ? 'Или войти с помощью' : 'Или зарегистрироваться через'}
              </span>
            </div>

            <div className={cx(styles, "auth-sso")}>
              {providers?.yandex && (
                <div className={cx(styles, "auth-yandex")}>
                  <button
                    className={cx(styles, "auth-yandex-official")}
                    type="button"
                    onClick={() => void handleOAuth('yandex')}
                    disabled={oauthLoading !== null}
                    aria-label="Войти с Яндекс ID"
                  >
                    <img src={yandexButton} alt="Войти с Яндекс ID" />
                  </button>
                </div>
              )}

              {providers?.vk && (
                <div className={cx(styles, "auth-vk")}>
                  <button
                    className={cx(styles, "auth-sso-button auth-vk-fallback")}
                    type="button"
                    onClick={() => void handleOAuth('vk')}
                    disabled={oauthLoading !== null}
                  >
                    <img className={cx(styles, "auth-sso-logo")} src={vkLogo} alt="" />
                    <span>{oauthLoading === 'vk' ? 'Переход в VK ID…' : 'VK ID'}</span>
                  </button>
                </div>
              )}

              {providers && !providers.yandex && !providers.vk && (
                <p className={cx(styles, "auth-sso-unavailable")}>
                  Вход через внешние сервисы не настроен.
                </p>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
