import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import AppHeader from '@components/layout/AppHeader';
import {
  BotIcon,
  DashboardIcon,
  GroupIcon,
  MonitorHeartIcon,
  RssIcon,
} from '@components/ui/icons';
import '@components/workspace/workspace.css';

import './Admin.css';

const TABS = [
  { to: '/admin', label: 'Обзор и метрики', icon: DashboardIcon, end: true },
  { to: '/admin/sources', label: 'Управление источниками', icon: RssIcon },
  { to: '/admin/llm', label: 'LLM и расход токенов', icon: BotIcon },
  { to: '/admin/users', label: 'Пользователи и роли', icon: GroupIcon },
  { to: '/admin/services', label: 'Состояние сервисов', icon: MonitorHeartIcon },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="ws-page admin-page">
      <AppHeader badge="Admin" onBrandClick={() => navigate('/')}>
        <button className="admin-back" type="button" onClick={() => navigate('/')}>
          В рабочее пространство
        </button>
      </AppHeader>

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
