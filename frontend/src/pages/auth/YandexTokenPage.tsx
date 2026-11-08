import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { loadScript } from '@utils/loadScript';

import AppHeader from '@components/layout/AppHeader';

import './AuthPage.css';

const YANDEX_TOKEN_SDK_URL =
  'https://yastatic.net/s3/passport-sdk/autofill/v1/sdk-suggest-token-with-polyfills-latest.js';

export default function YandexTokenPage() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [status, setStatus] = useState(() => {
    const error = params.get('error_description') || params.get('error');
    if (error) {
      return `Яндекс ID: ${error}`;
    }

    if (params.has('code')) {
      return 'Яндекс ID: код авторизации получен. Это тестовый режим — обмен на токен не выполняется.';
    }

    return 'Завершаем вход через Яндекс ID…';
  });

  const needsTokenSdk =
    !params.has('code') &&
    !params.has('error') &&
    !params.has('error_description');

  useEffect(() => {
    if (!needsTokenSdk) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        await loadScript(YANDEX_TOKEN_SDK_URL);

        if (!active) {
          return;
        }

        const sendToken = window.YaSendSuggestToken;
        if (!sendToken) {
          throw new Error('Yandex token SDK is unavailable');
        }

        const appOrigin =
          (import.meta.env.VITE_YANDEX_APP_ORIGIN as string | undefined) ||
          window.location.origin;

        sendToken(appOrigin, { flag: true });
        setStatus('Готово. Вернитесь на страницу входа.');
      } catch {
        if (active) {
          setStatus(
            'Не удалось передать ответ Яндекс ID. Вернитесь на страницу входа и попробуйте снова.',
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [needsTokenSdk]);

  return (
    <div className="auth-page">
      <AppHeader />
      <main className="auth-main">
        <div className="auth-wrap">
          <section className="auth-card auth-token-card">
            <div className="auth-logo">
              <img src="/icons/logo.svg" alt="" />
            </div>
            <h1 className="auth-title">Яндекс ID</h1>
            <p className="auth-token-status">{status}</p>
            <p className="auth-token-footer">
              <Link className="auth-link" to="/login">
                Вернуться ко входу
              </Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
