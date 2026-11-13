import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { forgotPassword } from '@api/auth';
import { AppHeader } from '@components';
import { AlertCircleIcon, AlternateEmailIcon, ArrowRightIcon } from '@components/ui';
import { cx } from '@utils/cx';

import authStyles from './AuthPage.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError('Введите email.');
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setMessage(
        'Если аккаунт с такой почтой существует, то на него придет письмо со ссылкой для сброса пароля.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить письмо.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cx(authStyles, 'auth-page')}>
      <AppHeader />
      <main className={cx(authStyles, 'auth-main')}>
        <div className={cx(authStyles, 'auth-wrap')}>
          <section className={cx(authStyles, 'auth-card')}>
            <h1 className={cx(authStyles, 'auth-title')}>Восстановление пароля</h1>
            <p className={cx(authStyles, 'auth-subtitle')}>
              Укажите email, привязанный к аккаунту.
            </p>
            <form className={cx(authStyles, 'auth-form')} onSubmit={handleSubmit} noValidate>
              {error && (
                <div className={cx(authStyles, 'auth-alert auth-alert--error')} role="alert">
                  <AlertCircleIcon />
                  <span>{error}</span>
                </div>
              )}
              {message && (
                <div className={cx(authStyles, 'auth-alert auth-alert--info')} role="status">
                  <span>{message}</span>
                </div>
              )}
              <div className={cx(authStyles, 'auth-field')}>
                <label className={cx(authStyles, 'auth-label')} htmlFor="forgot-email">
                  Email
                </label>
                <div className={cx(authStyles, 'auth-control')}>
                  <span className={cx(authStyles, 'auth-control-icon')}>
                    <AlternateEmailIcon />
                  </span>
                  <input
                    className={cx(authStyles, 'auth-input')}
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </div>
              <button className={cx(authStyles, 'auth-submit')} type="submit" disabled={loading}>
                <span>{loading ? 'Отправляем…' : 'Отправить ссылку'}</span>
                <ArrowRightIcon className={cx(authStyles, 'auth-submit-icon')} />
              </button>
              <Link className={cx(authStyles, 'auth-link')} to="/login">
                Вернуться ко входу
              </Link>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
