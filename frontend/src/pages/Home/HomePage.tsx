import { useNavigate } from 'react-router-dom';

import { clearSession, getCurrentUser } from '@api/auth';
import { LogoutIcon, ShieldHeartIcon } from '@components/ui/icons';

import './HomePage.css';

export default function HomePage() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <div className="home-page">
      <header className="home-topbar">
        <div className="home-brand">
          <span className="home-brand-mark">
            <ShieldHeartIcon />
          </span>
          <span className="home-brand-name">CyberTech</span>
        </div>

        <div className="home-user">
          <span className="home-user-name">{user?.username ?? 'Пользователь'}</span>
          <button className="home-logout" type="button" onClick={handleLogout}>
            <LogoutIcon />
            Выйти
          </button>
        </div>
      </header>

      <main className="home-main">
        <section className="home-card">
          <h1>Панель управления</h1>
          <p>
            Вы вошли как <strong>{user?.username ?? 'пользователь'}</strong>. Дашборд
            появится здесь на следующем этапе.
          </p>
        </section>
      </main>
    </div>
  );
}
