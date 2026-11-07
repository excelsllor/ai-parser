import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ShieldHeartIcon } from '@components/ui/icons';

import './AuthPage.css';

function getCallbackStatus(): string {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error_description') || params.get('error');

  if (error) {
    return `VK ID: ${error}`;
  }

  if (code) {
    return 'VK ID: код авторизации получен. Это тестовый режим — обмен на токен не выполняется.';
  }

  return 'VK ID: параметры авторизации не найдены.';
}

export default function VkCallbackPage() {
  const [status] = useState(getCallbackStatus);

  return (
    <div className="auth-page">
      <main className="auth-main">
        <div className="auth-wrap">
          <section className="auth-card auth-token-card">
            <div className="auth-logo">
              <ShieldHeartIcon />
            </div>
            <h1 className="auth-title">VK ID</h1>
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
