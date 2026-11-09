import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { confirmEmail } from '@api/auth';
import { AppHeader } from '@components';
import { CheckCircleIcon, ErrorIcon } from '@components/ui';
import { cx } from '@utils/cx';

import authStyles from './AuthPage.module.css';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>(
    token ? 'loading' : 'error',
  );
  const [error, setError] = useState(token ? '' : 'Ссылка не содержит токен.');

  useEffect(() => {
    if (!token) {
      return;
    }
    let active = true;
    void confirmEmail(token)
      .then(() => {
        if (active) {
          setStatus('ok');
        }
      })
      .catch((caught) => {
        if (active) {
          setStatus('error');
          setError(caught instanceof Error ? caught.message : 'Ссылка недействительна.');
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className={cx(authStyles, 'auth-page')}>
      <AppHeader />
      <main className={cx(authStyles, 'auth-main')}>
        <div className={cx(authStyles, 'auth-wrap')}>
          <section className={cx(authStyles, 'auth-card')}>
            <h1 className={cx(authStyles, 'auth-title')}>Подтверждение почты</h1>
            {status === 'loading' && <p className={cx(authStyles, 'auth-subtitle')}>Проверяем ссылку…</p>}
            {status === 'ok' && (
              <div className={cx(authStyles, 'auth-alert auth-alert--info')} role="status">
                <CheckCircleIcon />
                <span>Почта подтверждена.</span>
              </div>
            )}
            {status === 'error' && (
              <div className={cx(authStyles, 'auth-alert auth-alert--error')} role="alert">
                <ErrorIcon />
                <span>{error}</span>
              </div>
            )}
            <Link className={cx(authStyles, 'auth-link')} to="/login">
              Перейти ко входу
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
