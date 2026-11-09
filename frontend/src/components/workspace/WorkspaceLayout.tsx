import { useState } from 'react';
import type { ReactNode, UIEvent } from 'react';

import type { RunSummary } from '@api/runs';
import AppHeader from '@components/layout/AppHeader';
import { AddIcon, DeleteIcon, MenuIcon } from '@components/ui';

import { cx } from '@utils/cx';

import workspaceStyles from './workspace.module.css';

const styles = workspaceStyles;

interface WorkspaceLayoutProps {
  children: ReactNode;
  runs: RunSummary[];
  activeRunId?: string | null;
  loadingRuns?: boolean;
  loadingMoreRuns?: boolean;
  hasMoreRuns?: boolean;
  onLoadMoreRuns?: () => void;
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
  loadingMoreRuns = false,
  hasMoreRuns = false,
  onLoadMoreRuns,
  onSelectRun,
  onDeleteRun,
  onNewQuery,
}: WorkspaceLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 1100px)').matches) {
      setSidebarOpen((value) => !value);
      return;
    }
    setSidebarCollapsed((value) => !value);
  }

  function handleSessionsScroll(event: UIEvent<HTMLElement>) {
    if (!onLoadMoreRuns || loadingMoreRuns || !hasMoreRuns) {
      return;
    }
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 64) {
      onLoadMoreRuns();
    }
  }

  function handleNewQuery() {
    setSidebarOpen(false);
    onNewQuery();
  }

  function handleSelectRun(run: RunSummary) {
    setSidebarOpen(false);
    onSelectRun(run);
  }

  return (
    <div className={cx(styles, `ws-page${sidebarCollapsed ? ' ws-page--sidebar-hidden' : ''}`)}>
      <AppHeader
        left={
          <button
            className={cx(styles, "ws-icon-button ws-menu-button")}
            type="button"
            aria-label="Меню сессий"
            onClick={toggleSidebar}
          >
            <MenuIcon />
          </button>
        }
        badge="AI"
      />

      <div className={cx(styles, "ws-body")}>
        {sidebarOpen && (
          <button
            className={cx(styles, "ws-backdrop")}
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={cx(styles, `ws-sidebar${sidebarOpen ? ' ws-sidebar--open' : ''}`)}>
          <div className={cx(styles, "ws-sidebar-top")}>
            <button className={cx(styles, "ws-new-query")} type="button" onClick={handleNewQuery}>
              <AddIcon />
              Новый запрос
            </button>

            <div className={cx(styles, "ws-sidebar-label")}>
              <span>Недавние сессии</span>
              <span>
                {recordsLabel(runs.length)}
                {hasMoreRuns ? '+' : ''}
              </span>
            </div>

            <nav
              className={cx(styles, "ws-sessions")}
              aria-label="Недавние сессии"
              onScroll={handleSessionsScroll}
            >
              {loadingRuns && <span className={cx(styles, "ws-sidebar-note")}>Загрузка…</span>}
              {!loadingRuns && runs.length === 0 && (
                <span className={cx(styles, "ws-sidebar-note")}>Пока нет запусков</span>
              )}
              {runs.map((run) => (
                <div
                  className={cx(styles, `ws-session${
                    run.id === activeRunId ? ' ws-session--active' : ''
                  }`)}
                  key={run.id}
                >
                  <button
                    className={cx(styles, "ws-session-open")}
                    type="button"
                    onClick={() => handleSelectRun(run)}
                  >
                    <span className={cx(styles, "ws-session-top")}>
                      <span className={cx(styles, "ws-session-title")}>
                        Запуск {shortId(run.id)}
                      </span>
                    </span>
                    <span className={cx(styles, "ws-session-meta")}>
                      <span>{formatDate(run.control_time)}</span>
                    </span>
                  </button>
                  <span className={cx(styles, `ws-status-dot ws-status-dot--${statusClass(run.status)}`)} />
                  {onDeleteRun && (
                    <button
                      className={cx(styles, "ws-session-delete")}
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
              {loadingMoreRuns && (
                <span className={cx(styles, "ws-sidebar-note")}>Загрузка…</span>
              )}
              {hasMoreRuns && !loadingMoreRuns && onLoadMoreRuns && (
                <button
                  className={cx(styles, "ws-sessions-more")}
                  type="button"
                  onClick={onLoadMoreRuns}
                >
                  Показать ещё
                </button>
              )}
            </nav>
          </div>
        </aside>

        <main className={cx(styles, "ws-main")}>{children}</main>
      </div>
    </div>
  );
}
