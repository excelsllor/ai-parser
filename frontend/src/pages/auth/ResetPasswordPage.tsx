import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { resetPassword } from '@api/auth';
import { AppHeader } from '@components';
import { AlertCircleIcon, ArrowRightIcon, LockIcon } from '@components/ui';
import { cx } from '@utils/cx';
import { useToast } from '@context/toast';

import authStyles from './AuthPage.module.css';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { pushToast } = useToast();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError('Ссылка не содержит токен.');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен содержать не менее 8 символов.');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      pushToast('success', 'Пароль изменён. Войдите с новым паролем.');
      navigate('/login', { replace: true });
    } catch (caught) {
      pushToast(
        'error',
        caught instanceof Error ? caught.message : 'Не удалось сменить пароль.',
      );
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
            <h1 className={cx(authStyles, 'auth-title')}>Новый пароль</h1>
            <form className={cx(authStyles, 'auth-form')} onSubmit={handleSubmit} noValidate>
              {error && (
                <div className={cx(authStyles, 'auth-alert auth-alert--error')} role="alert">
                  <AlertCircleIcon />
                  <span>{error}</span>
                </div>
              )}
              <div className={cx(authStyles, 'auth-field')}>
                <label className={cx(authStyles, 'auth-label')} htmlFor="reset-password">
                  Новый пароль
                </label>
                <div className={cx(authStyles, 'auth-control')}>
                  <span className={cx(authStyles, 'auth-control-icon')}>
                    <LockIcon />
                  </span>
                  <input
                    className={cx(authStyles, 'auth-input')}
                    id="reset-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>
              <div className={cx(authStyles, 'auth-field')}>
                <label className={cx(authStyles, 'auth-label')} htmlFor="reset-confirm">
                  Повторите пароль
                </label>
                <div className={cx(authStyles, 'auth-control')}>
                  <span className={cx(authStyles, 'auth-control-icon')}>
                    <LockIcon />
                  </span>
                  <input
                    className={cx(authStyles, 'auth-input')}
                    id="reset-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </div>
              </div>
              <button className={cx(authStyles, 'auth-submit')} type="submit" disabled={loading}>
                <span>{loading ? 'Сохраняем…' : 'Сменить пароль'}</span>
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
