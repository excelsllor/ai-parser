import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { completeOAuth, saveSession } from '@api/auth';
import { AppHeader } from '@components';

import { cx } from '@utils/cx';

import authStyles from './AuthPage.module.css';

const styles = authStyles;

export default function VkCallbackPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [status, setStatus] = useState(() => {
    const error = params.get('error_description') || params.get('error');
    if (error) {
      return `VK ID: ${error}`;
    }
    if (!params.get('code') || !params.get('state')) {
      return 'VK ID: параметры авторизации не найдены.';
    }
    return 'Завершаем вход через VK ID…';
  });

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      return;
    }

    void completeOAuth('vk', code, state)
      .then((session) => {
        saveSession(session, true);
        navigate('/', { replace: true });
      })
      .catch((caught: unknown) => {
        setStatus(
          caught instanceof Error
            ? `VK ID: ${caught.message}`
            : 'VK ID: не удалось завершить вход.',
        );
      });
  }, [navigate, params]);

  return (
    <div className={cx(styles, "auth-page")}>
      <AppHeader />
      <main className={cx(styles, "auth-main")}>
        <div className={cx(styles, "auth-wrap")}>
          <section className={cx(styles, "auth-card auth-token-card")}>
            <div className={cx(styles, "auth-logo")}>
              <img src="/icons/logo.svg" alt="" />
            </div>
            <h1 className={cx(styles, "auth-title")}>VK ID</h1>
            <p className={cx(styles, "auth-token-status")}>{status}</p>
            <p className={cx(styles, "auth-token-footer")}>
              <Link className={cx(styles, "auth-link")} to="/login">
                Вернуться ко входу
              </Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
