import { Link, useLocation } from 'react-router-dom';

import { getCurrentUser } from '@api/auth';
import {
  DashboardIcon,
  MonitorHeartIcon,
  UserIcon,
} from '@components/ui/icons';

const ITEMS = [
  {
    to: '/',
    label: 'Мониторинг',
    icon: MonitorHeartIcon,
    match: (path: string) => path === '/' || path.startsWith('/runs'),
  },
  {
    to: '/profile',
    label: 'Профиль',
    icon: UserIcon,
    match: (path: string) => path.startsWith('/profile'),
  },
  {
    to: '/admin',
    label: 'Администрирование',
    icon: DashboardIcon,
    admin: true,
    match: (path: string) => path.startsWith('/admin'),
  },
];

export default function AppNav() {
  const { pathname } = useLocation();
  const isAdmin = getCurrentUser()?.role === 'admin';

  return (
    <nav className="app-nav" aria-label="Основное меню">
      {ITEMS.filter((item) => !item.admin || isAdmin).map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <Link
            className={`app-nav-item${active ? ' app-nav-item--active' : ''}`}
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            title={item.label}
          >
            <Icon />
            <span className="app-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
