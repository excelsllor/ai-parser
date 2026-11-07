import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { login, saveSession } from '@api/auth';
import { ApiError } from '@api/http';
import vkLogo from '@assets/providers/vk.svg';
import yandexButton from '@assets/providers/yandex-button.svg';
import {
  AlertCircleIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  ShieldHeartIcon,
  SparklesIcon,
} from '@components/ui/icons';
import { loadScript } from '@utils/loadScript';

import './AuthPage.css';

type Tab = 'login' | 'register';

const YANDEX_SDK_URL =
  'https://yastatic.net/s3/passport-sdk/autofill/v1/sdk-suggest-with-polyfills-latest.js';
const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined;
const YANDEX_REDIRECT_URI = import.meta.env.VITE_YANDEX_REDIRECT_URI as
  | string
  | undefined;

const VK_SDK_URL = 'https://unpkg.com/@vkid/sdk@%3C3.0.0/dist-sdk/umd/index.js';
const VK_APP_ID = Number(import.meta.env.VITE_VK_APP_ID || 54883348);
const VK_REDIRECT_URL = import.meta.env.VITE_VK_REDIRECT_URL as string | undefined;

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const tab: Tab = location.pathname === '/register' ? 'register' : 'login';

  const [username, setUsername] = useState('');
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

  const yandexStarted = useRef(false);
  const [yandexReady, setYandexReady] = useState(false);

  const vkStarted = useRef(false);
  const vkContainerRef = useRef<HTMLDivElement>(null);
  const [vkStatus, setVkStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (yandexStarted.current) {
      return;
    }
    yandexStarted.current = true;

    if (!YANDEX_CLIENT_ID) {
      return;
    }

    const isStandardHttps =
      window.location.protocol === 'https:' &&
      (window.location.port === '' || window.location.port === '443');
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!isStandardHttps && !isLocalhost) {
      return;
    }

    const redirectUri =
      YANDEX_REDIRECT_URI || `${window.location.origin}/auth/yandex/token`;

    void (async () => {
      try {
        await loadScript(YANDEX_SDK_URL);
        const sdk = window.YaAuthSuggest;
        if (!sdk) {
          throw new Error('Yandex SDK is unavailable');
        }

        const { handler } = await sdk.init(
          {
            client_id: YANDEX_CLIENT_ID,
            response_type: 'token',
            redirect_uri: redirectUri,
          },
          window.location.origin,
          {
            view: 'button',
            parentId: 'yandex-auth-button',
            buttonView: 'main',
            buttonTheme: 'light',
            buttonSize: 'm',
            buttonBorderRadius: '8',
            buttonIcon: 'ya',
          },
        );

        const resultPromise = handler();
        setYandexReady(true);
        const result = await resultPromise;

        if (result.status === 'ok') {
          setNotice(
            'Яндекс ID: вход выполнен. Это тестовый режим — токен не отправляется на сервер.',
          );
        }
      } catch {
        setNotice(
          'Кнопка Яндекс ID недоступна. Проверьте Redirect URI в настройках OAuth-приложения.',
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (vkStarted.current) {
      return;
    }
    vkStarted.current = true;

    const container = vkContainerRef.current;
    if (!container) {
      return;
    }

    const redirectUrl =
      VK_REDIRECT_URL || `${window.location.origin}/auth/vk/callback`;

    void (async () => {
      try {
        await loadScript(VK_SDK_URL);
        const VKID = window.VKIDSDK;
        if (!VKID) {
          throw new Error('VK ID SDK is unavailable');
        }

        VKID.Config.init({
          app: VK_APP_ID,
          redirectUrl,
          responseMode: VKID.ConfigResponseMode.Callback,
          source: VKID.ConfigSource.LOWCODE,
          scope: '',
        });

        const oneTap = new VKID.OneTap();
        oneTap
          .render({
            container,
            showAlternativeLogin: true,
            styles: {
              width: 280,
            },
            oauthList: ['ok_ru', 'mail_ru'],
          })
          .on(VKID.WidgetEvents.ERROR, () => {
            setNotice('VK ID: не удалось открыть виджет. Попробуйте позже.');
          })
          .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, () => {
            setNotice(
              'VK ID: вход выполнен. Это тестовый режим — токен не запрашивается.',
            );
          });

        setVkStatus('ready');
      } catch {
        setVkStatus('failed');
        setNotice('Виджет VK ID недоступен. Проверьте блокировку скриптов.');
      }
    })();
  }, []);

  function switchTab(next: Tab) {
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

  function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!username.trim() || !password || !confirmPassword) {
      setError('Заполните все поля.');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен содержать не менее 8 символов.');
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

    setNotice(
      'Самостоятельная регистрация пока не подключена. Аккаунты создаёт администратор.',
    );
  }

  function handleSso(provider: string) {
    setError(null);
    setNotice(`Вход через ${provider} пока не подключён.`);
  }

  function startYandexOAuth() {
    setError(null);
    setNotice(null);

    if (!YANDEX_CLIENT_ID) {
      setNotice('Яндекс ID не настроен: отсутствует client_id.');
      return;
    }

    const redirectUri =
      YANDEX_REDIRECT_URI || `${window.location.origin}/auth/yandex/token`;
    const url = new URL('https://oauth.yandex.ru/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', YANDEX_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    window.location.assign(url.toString());
  }

  return (
    <div className="auth-page">
      <header className="auth-topbar">
        <div className="auth-brand">
          <span className="auth-brand-mark">
            <ShieldHeartIcon />
          </span>
          <span className="auth-brand-name">CyberTech</span>
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-wrap">
          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-card-head">
              <div className="auth-logo">
                <ShieldHeartIcon />
              </div>
              <h1 className="auth-title" id="auth-title">
                CyberTech
              </h1>
              <span className="auth-badge">
                <SparklesIcon />
                Платформа ИИ-мониторинга угроз
              </span>
            </div>

            <div className="auth-tabs" role="tablist" aria-label="Авторизация">
              <button
                className={`auth-tab${tab === 'login' ? ' auth-tab--active' : ''}`}
                type="button"
                role="tab"
                aria-selected={tab === 'login'}
                onClick={() => switchTab('login')}
              >
                Вход
              </button>
              <button
                className={`auth-tab${tab === 'register' ? ' auth-tab--active' : ''}`}
                type="button"
                role="tab"
                aria-selected={tab === 'register'}
                onClick={() => switchTab('register')}
              >
                Регистрация
              </button>
            </div>

            {error && (
              <div className="auth-alert auth-alert--error" role="alert">
                <AlertCircleIcon />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className="auth-alert auth-alert--info" role="status">
                <InfoIcon />
                <span>{notice}</span>
              </div>
            )}

            {tab === 'login' ? (
              <form className="auth-form" onSubmit={handleLogin} noValidate>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="login-username">
                    Email или логин
                  </label>
                  <div className="auth-control">
                    <span className="auth-control-icon">
                      <MailIcon />
                    </span>
                    <input
                      className="auth-input"
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

                <div className="auth-field">
                  <label className="auth-label" htmlFor="login-password">
                    Пароль
                  </label>
                  <div className="auth-control">
                    <span className="auth-control-icon">
                      <LockIcon />
                    </span>
                    <input
                      className="auth-input auth-input--password"
                      id="login-password"
                      name="password"
                      type={showLoginPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Введите пароль"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      className="auth-password-toggle"
                      type="button"
                      aria-label={showLoginPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowLoginPassword((value) => !value)}
                    >
                      {showLoginPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <div className="auth-options">
                  <label className="auth-checkbox-label">
                    <input
                      className="auth-checkbox"
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                    />
                    Запомнить меня
                  </label>
                  <button
                    className="auth-link"
                    type="button"
                    onClick={() => setNotice('Восстановление пароля пока не подключено. Обратитесь к администратору.')}
                  >
                    Забыли пароль?
                  </button>
                </div>

                <button className="auth-submit" type="submit" disabled={loading}>
                  <span>{loading ? 'Входим…' : 'Войти в систему'}</span>
                  <ArrowRightIcon className="auth-submit-icon" />
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleRegister} noValidate>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="register-username">
                    Имя пользователя или Email
                  </label>
                  <div className="auth-control">
                    <span className="auth-control-icon">
                      <MailIcon />
                    </span>
                    <input
                      className="auth-input"
                      id="register-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      placeholder="name@company.com"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-label" htmlFor="register-password">
                    Пароль
                  </label>
                  <div className="auth-control">
                    <span className="auth-control-icon">
                      <LockIcon />
                    </span>
                    <input
                      className="auth-input auth-input--password"
                      id="register-password"
                      name="new-password"
                      type={showRegisterPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Создайте надёжный пароль"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      className="auth-password-toggle"
                      type="button"
                      aria-label={showRegisterPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowRegisterPassword((value) => !value)}
                    >
                      {showRegisterPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-label" htmlFor="register-confirm">
                    Подтверждение пароля
                  </label>
                  <div className="auth-control">
                    <span className="auth-control-icon">
                      <LockIcon />
                    </span>
                    <input
                      className="auth-input auth-input--password"
                      id="register-confirm"
                      name="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Повторите пароль"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <button
                      className="auth-password-toggle"
                      type="button"
                      aria-label={showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowConfirmPassword((value) => !value)}
                    >
                      {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <div className="auth-terms">
                  <label className="auth-checkbox-label auth-checkbox-label--terms">
                    <input
                      className="auth-checkbox"
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                    />
                    <span>
                      Я согласен с{' '}
                      <button
                        className="auth-link"
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
                        className="auth-link"
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

                <button className="auth-submit" type="submit">
                  <span>Создать аккаунт</span>
                  <ArrowRightIcon className="auth-submit-icon" />
                </button>
              </form>
            )}

            <div className="auth-divider">
              <span>
                {tab === 'login' ? 'Или войти с помощью' : 'Или зарегистрироваться через'}
              </span>
            </div>

            <div className="auth-sso">
              <div className="auth-yandex">
                <div className="auth-yandex-sdk" id="yandex-auth-button" />
                {!yandexReady && (
                  <button
                    className="auth-yandex-official"
                    type="button"
                    onClick={startYandexOAuth}
                    aria-label="Войти с Яндекс ID"
                  >
                    <img src={yandexButton} alt="Войти с Яндекс ID" />
                  </button>
                )}
              </div>

              <div className="auth-vk">
                <div className="auth-vk-sdk" ref={vkContainerRef} />
                {vkStatus === 'failed' && (
                  <button
                    className="auth-sso-button auth-vk-fallback"
                    type="button"
                    onClick={() => handleSso('VK ID')}
                  >
                    <img className="auth-sso-logo" src={vkLogo} alt="" />
                    <span>VK ID</span>
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
