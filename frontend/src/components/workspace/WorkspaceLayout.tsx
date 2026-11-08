import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { clearSession, getCurrentUser } from '@api/auth';
import type { RunSummary } from '@api/runs';
import AppHeader from '@components/layout/AppHeader';
import {
  AddIcon,
  ChevronDownIcon,
  DashboardIcon,
  DeleteIcon,
  LogoutIcon,
  MenuIcon,
  UserIcon,
} from '@components/ui/icons';

import './workspace.css';

interface WorkspaceLayoutProps {
  children: ReactNode;
  runs: RunSummary[];
  activeRunId?: string | null;
  loadingRuns?: boolean;
  onSelectRun: (run: RunSummary) => void;
  onDeleteRun?: (run: RunSummary) => void;
  onNewQuery: () => void;
}

function recordsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} запись`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} записи`;
  }
  return `${count} записей`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

function statusClass(status: string): string {
  return ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status)
    ? status
    : 'queued';
}

export default function WorkspaceLayout({
  children,
  runs,
  activeRunId,
  loadingRuns = false,
  onSelectRun,
  onDeleteRun,
  onNewQuery,
}: WorkspaceLayoutProps) {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.ws-user-wrap')) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [userMenuOpen]);

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 1100px)').matches) {
      setSidebarOpen((value) => !value);
      return;
    }
    setSidebarCollapsed((value) => !value);
  }

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  function handleNewQuery() {
    setSidebarOpen(false);
    onNewQuery();
  }

  function handleSelectRun(run: RunSummary) {
    setSidebarOpen(false);
    onSelectRun(run);
  }

  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();
  const roleLabel = user?.role === 'admin' ? 'Администратор' : 'Аналитик';

  return (
    <div className={`ws-page${sidebarCollapsed ? ' ws-page--sidebar-hidden' : ''}`}>
      <AppHeader
        left={
          <button
            className="ws-icon-button ws-menu-button"
            type="button"
            aria-label="Меню сессий"
            onClick={toggleSidebar}
          >
            <MenuIcon />
          </button>
        }
        badge="AI"
      >
        <span className="ws-header-divider" />
        <div className="ws-user-wrap">
          <button
            className="ws-user"
            type="button"
            onClick={() => setUserMenuOpen((value) => !value)}
          >
            <span className="ws-avatar">{initials}</span>
            <span className="ws-user-text">
              <span className="ws-user-name">{user?.username ?? 'Пользователь'}</span>
              <span className="ws-user-role">{roleLabel}</span>
            </span>
            <ChevronDownIcon className="ws-user-chevron" />
          </button>

          {userMenuOpen && (
            <div className="ws-user-menu">
              <div className="ws-user-menu-head">
                <span>{user?.username ?? 'Пользователь'}</span>
                <span>{roleLabel}</span>
              </div>
              <button
                className="ws-user-menu-item ws-user-menu-item--profile"
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
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
                    setUserMenuOpen(false);
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
      </AppHeader>

      <div className="ws-body">
        {sidebarOpen && (
          <button
            className="ws-backdrop"
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={`ws-sidebar${sidebarOpen ? ' ws-sidebar--open' : ''}`}>
          <div className="ws-sidebar-top">
            <button className="ws-new-query" type="button" onClick={handleNewQuery}>
              <AddIcon />
              Новый запрос
            </button>

            <div className="ws-sidebar-label">
              <span>Недавние сессии</span>
              <span>{recordsLabel(runs.length)}</span>
            </div>

            <nav className="ws-sessions" aria-label="Недавние сессии">
              {loadingRuns && <span className="ws-sidebar-note">Загрузка…</span>}
              {!loadingRuns && runs.length === 0 && (
                <span className="ws-sidebar-note">Пока нет запусков</span>
              )}
              {runs.map((run) => (
                <div
                  className={`ws-session${
                    run.id === activeRunId ? ' ws-session--active' : ''
                  }`}
                  key={run.id}
                >
                  <button
                    className="ws-session-open"
                    type="button"
                    onClick={() => handleSelectRun(run)}
                  >
                    <span className="ws-session-top">
                      <span className="ws-session-title">
                        Запуск {shortId(run.id)}
                      </span>
                    </span>
                    <span className="ws-session-meta">
                      <span>{formatDate(run.control_time)}</span>
                    </span>
                  </button>
                  <span className={`ws-status-dot ws-status-dot--${statusClass(run.status)}`} />
                  {onDeleteRun && (
                    <button
                      className="ws-session-delete"
                      type="button"
                      title="Удалить сессию"
                      aria-label="Удалить сессию"
                      onClick={() => onDeleteRun(run)}
                    >
                      <DeleteIcon />
                    </button>
                  )}
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <main className="ws-main">{children}</main>
      </div>
    </div>
  );
}
