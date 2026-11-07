import { useEffect, useState } from 'react';

import { ShieldHeartIcon } from '@components/ui/icons';
import { loadScript } from '@utils/loadScript';

import './AuthPage.css';

const YANDEX_TOKEN_SDK_URL =
  'https://yastatic.net/s3/passport-sdk/autofill/v1/sdk-suggest-token-with-polyfills-latest.js';

export default function YandexTokenPage() {
  const [status, setStatus] = useState('Завершаем вход через Яндекс ID…');

  useEffect(() => {
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
  }, []);

  return (
    <div className="auth-page">
      <main className="auth-main">
        <div className="auth-wrap">
          <section className="auth-card auth-token-card">
            <div className="auth-logo">
              <ShieldHeartIcon />
            </div>
            <h1 className="auth-title">Яндекс ID</h1>
            <p className="auth-token-status">{status}</p>
          </section>
        </div>
      </main>
    </div>
  );
}
