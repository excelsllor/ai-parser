import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { getCurrentUser } from '@api/auth';
import {
  DashboardIcon,
  MonitorHeartIcon,
  UserIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

import appStyles from '@components/layout/AppHeader.module.css';

const styles = appStyles;

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
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const items = ITEMS.filter((item) => !item.admin || isAdmin);

  useLayoutEffect(() => {
    const update = () => {
      const element = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (element) {
        setIndicator({ left: element.offsetLeft, width: element.offsetWidth });
      } else {
        setIndicator({ left: 0, width: 0 });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pathname, isAdmin]);

  return (
    <nav className={cx(styles, "app-nav")} aria-label="Основное меню" ref={navRef}>
      <span
        className={cx(styles, "app-nav-indicator")}
        style={{ left: indicator.left, width: indicator.width }}
        aria-hidden="true"
      />
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <Link
            className={cx(styles, `app-nav-item${active ? ' app-nav-item--active' : ''}`)}
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            title={item.label}
          >
            <Icon />
            <span className={cx(styles, "app-nav-label")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
