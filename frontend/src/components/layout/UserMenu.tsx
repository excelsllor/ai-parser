import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getCurrentUser, logout } from '@api/auth';
import {
  ChevronDownIcon,
  DashboardIcon,
  LogoutIcon,
  MonitorHeartIcon,
  UserIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

import workspaceStyles from '@components/workspace/workspace.module.css';

const styles = workspaceStyles;

export default function UserMenu() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !containerRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();
  const roleLabel = user?.role === 'admin' ? 'Администратор' : 'Пользователь';

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className={cx(styles, "ws-user-wrap")} ref={containerRef}>
      <button
        className={cx(styles, "ws-user")}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={cx(styles, "ws-avatar")}>{initials}</span>
        <span className={cx(styles, "ws-user-text")}>
          <span className={cx(styles, "ws-user-name")}>{user?.username ?? 'Пользователь'}</span>
          <span className={cx(styles, "ws-user-role")}>{roleLabel}</span>
        </span>
        <ChevronDownIcon className={cx(styles, "ws-user-chevron")} />
      </button>

      {open && (
        <div className={cx(styles, "ws-user-menu")}>
          <div className={cx(styles, "ws-user-menu-head")}>
            <span>{user?.username ?? 'Пользователь'}</span>
            <span>{roleLabel}</span>
          </div>
          <button
            className={cx(styles, "ws-user-menu-item")}
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/');
            }}
          >
            <MonitorHeartIcon />
            Мониторинг
          </button>
          <button
            className={cx(styles, "ws-user-menu-item ws-user-menu-item--profile")}
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
              className={cx(styles, "ws-user-menu-item")}
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
          <button className={cx(styles, "ws-user-menu-item ws-user-menu-item--danger")} type="button" onClick={() => void handleLogout()}>
            <LogoutIcon />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
