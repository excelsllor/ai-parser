import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import AppHeader from '@components/layout/AppHeader';
import {
  BotIcon,
  DashboardIcon,
  GroupIcon,
  RssIcon,
  SendIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

import adminStyles from './Admin.module.css';
import workspaceStyles from '@components/workspace/workspace.module.css';

const styles = { ...workspaceStyles, ...adminStyles };

const TABS = [
  { to: '/admin', label: 'Обзор и метрики', icon: DashboardIcon, end: true },
  { to: '/admin/sources', label: 'Управление источниками', icon: RssIcon },
  { to: '/admin/llm', label: 'LLM', icon: BotIcon },
  { to: '/admin/telegram', label: 'Telegram', icon: SendIcon },
  { to: '/admin/users', label: 'Пользователи и роли', icon: GroupIcon },
];

export default function AdminLayout() {
  const { pathname } = useLocation();
  const tabsRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const update = () => {
      const element = tabsRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (element) {
        setIndicator({ left: element.offsetLeft, width: element.offsetWidth });
      } else {
        setIndicator({ left: 0, width: 0 });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pathname]);

  return (
    <div className={cx(styles, "ws-page admin-page")}>
      <AppHeader badge="Admin" />

      <nav
        className={cx(styles, "admin-tabs")}
        aria-label="Разделы администрирования"
        ref={tabsRef}
      >
        <span
          className={cx(styles, "admin-tab-indicator")}
          style={{ left: indicator.left, width: indicator.width }}
          aria-hidden="true"
        />
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              className={({ isActive }) =>
                cx(styles, `admin-tab${isActive ? ' admin-tab--active' : ''}`)
              }
              end={tab.end}
              key={tab.to}
              to={tab.to}
            >
              <Icon />
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      <main className={cx(styles, "admin-main")}>
        <Outlet />
      </main>
    </div>
  );
}
