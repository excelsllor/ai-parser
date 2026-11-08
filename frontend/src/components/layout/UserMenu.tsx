import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { clearSession, getCurrentUser } from '@api/auth';
import {
  ChevronDownIcon,
  DashboardIcon,
  LogoutIcon,
  UserIcon,
} from '@components/ui/icons';

export default function UserMenu() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.ws-user-wrap')) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();
  const roleLabel = user?.role === 'admin' ? 'Администратор' : 'Аналитик';

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <div className="ws-user-wrap">
      <button
        className="ws-user"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ws-avatar">{initials}</span>
        <span className="ws-user-text">
          <span className="ws-user-name">{user?.username ?? 'Пользователь'}</span>
          <span className="ws-user-role">{roleLabel}</span>
        </span>
        <ChevronDownIcon className="ws-user-chevron" />
      </button>

      {open && (
        <div className="ws-user-menu">
          <div className="ws-user-menu-head">
            <span>{user?.username ?? 'Пользователь'}</span>
            <span>{roleLabel}</span>
          </div>
          <button
            className="ws-user-menu-item ws-user-menu-item--profile"
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            <UserIcon />
            Профиль
          </button>
          {user?.role === 'admin' && (
            <button
              className="ws-user-menu-item"
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/admin');
              }}
            >
              <DashboardIcon />
              Администрирование
            </button>
          )}
          <button className="ws-user-menu-item" type="button" onClick={handleLogout}>
            <LogoutIcon />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
