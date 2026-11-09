import { useRef, type ReactNode } from 'react';
import { animate } from 'animejs';
import { useNavigate } from 'react-router-dom';

import { getAccessToken } from '@api/auth';
import AppNav from '@components/layout/AppNav';
import UserMenu from '@components/layout/UserMenu';
import { MoonIcon, SunIcon } from '@components/ui';
import { useTheme } from '@hooks/useTheme';
import { cx } from '@utils/cx';

import appStyles from './AppHeader.module.css';

const styles = appStyles;

interface AppHeaderProps {
  left?: ReactNode;
  nav?: ReactNode;
  children?: ReactNode;
  badge?: string;
  sub?: string;
  onBrandClick?: () => void;
}

export default function AppHeader({
  left,
  nav,
  children,
  badge,
  sub,
  onBrandClick,
}: AppHeaderProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const authenticated = Boolean(getAccessToken());
  const themeIconRef = useRef<HTMLSpanElement>(null);

  function handleThemeToggle() {
    const icon = themeIconRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (icon && !reduceMotion) {
      animate(icon, {
        rotate: [theme === 'dark' ? '90deg' : '-90deg', '0deg'],
        scale: [0.76, 1],
        opacity: [0.5, 1],
        duration: 520,
        ease: 'inOutQuint',
      });
    }

    toggleTheme();
  }

  const brand = (
    <>
      <span className={cx(styles, "app-brand-mark")}>
        <img src="/icons/logo.svg" alt="" />
      </span>
      <span className={cx(styles, "app-brand-text")}>
        <span className={cx(styles, "app-brand-title")}>
          CyberBug
          {badge && <span className={cx(styles, "app-brand-badge")}>{badge}</span>}
        </span>
        {sub && <span className={cx(styles, "app-brand-sub")}>{sub}</span>}
      </span>
    </>
  );

  const handleBrandClick =
    onBrandClick ?? (() => navigate(authenticated ? '/' : '/login'));

  return (
    <header className={cx(styles, "app-header")}>
      <div className={cx(styles, "app-header-left")}>
        {left}
        <button className={cx(styles, "app-brand")} type="button" onClick={handleBrandClick}>
          {brand}
        </button>
      </div>

      <div className={cx(styles, "app-header-center")}>
        {nav ?? (authenticated ? <AppNav /> : undefined)}
      </div>

      <div className={cx(styles, "app-header-right")}>
        <button
          className={cx(styles, "app-header-icon")}
          type="button"
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          onClick={handleThemeToggle}
        >
          <span className={cx(styles, "app-theme-icon")} ref={themeIconRef}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </span>
        </button>
        {children ?? (authenticated ? <UserMenu /> : undefined)}
      </div>
    </header>
  );
}
