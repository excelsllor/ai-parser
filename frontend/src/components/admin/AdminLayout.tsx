import { NavLink, Outlet } from 'react-router-dom';

import AppHeader from '@components/layout/AppHeader';
import {
  BotIcon,
  DashboardIcon,
  GroupIcon,
  RssIcon,
} from '@components/ui/icons';
import '@components/workspace/workspace.css';

import './Admin.css';

const TABS = [
  { to: '/admin', label: 'Обзор и метрики', icon: DashboardIcon, end: true },
  { to: '/admin/sources', label: 'Управление источниками', icon: RssIcon },
  { to: '/admin/llm', label: 'LLM', icon: BotIcon },
  { to: '/admin/users', label: 'Пользователи и роли', icon: GroupIcon },
];

export default function AdminLayout() {
  return (
    <div className="ws-page admin-page">
      <AppHeader badge="Admin" />

      <nav className="admin-tabs" aria-label="Разделы администрирования">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              className={({ isActive }) =>
                `admin-tab${isActive ? ' admin-tab--active' : ''}`
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

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
