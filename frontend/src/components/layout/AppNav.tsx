import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { getCurrentUser } from '@api/auth';
import {
  DashboardIcon,
  GameIcon,
  MonitorHeartIcon,
  UserIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

import appStyles from '@components/layout/AppHeader.module.css';

const styles = appStyles;

let lastIndicator = { left: 0, width: 0 };
let measuredOnce = false;

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
  {
    to: '/games',
    label: 'Игры',
    icon: GameIcon,
    match: (path: string) => path.startsWith('/games'),
  },
];

export default function AppNav() {
  const { pathname } = useLocation();
  const isAdmin = getCurrentUser()?.role === 'admin';
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState(lastIndicator);
  const [animate, setAnimate] = useState(measuredOnce);
  const items = ITEMS.filter((item) => !item.admin || isAdmin);

  useLayoutEffect(() => {
    const measure = () => {
      const element = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      const next = element
        ? { left: element.offsetLeft, width: element.offsetWidth }
        : { left: 0, width: 0 };
      lastIndicator = next;
      setIndicator(next);
    };

    let raf = 0;
    if (measuredOnce) {
      // Keep the previous tab for one paint, then slide to the new one.
      raf = window.requestAnimationFrame(measure);
    } else {
      measuredOnce = true;
      measure();
    }
    const enableRaf = window.requestAnimationFrame(() => setAnimate(true));
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(enableRaf);
      window.removeEventListener('resize', measure);
    };
  }, [pathname, isAdmin]);

  return (
    <nav className={cx(styles, "app-nav")} aria-label="Основное меню" ref={navRef}>
      <span
        className={cx(
          styles,
          `app-nav-indicator${animate ? ' app-nav-indicator--animate' : ''}`,
        )}
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
