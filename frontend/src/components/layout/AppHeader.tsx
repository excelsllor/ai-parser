import type { ReactNode } from 'react';

import { useTheme } from '@hooks/useTheme';
import { MoonIcon, SunIcon } from '@components/ui/icons';

import './AppHeader.css';

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
  const { theme, toggleTheme } = useTheme();

  const brand = (
    <>
      <span className="app-brand-mark">
        <img src="/icons/logo.svg" alt="" />
      </span>
      <span className="app-brand-text">
        <span className="app-brand-title">
          CyberBug
          {badge && <span className="app-brand-badge">{badge}</span>}
        </span>
        {sub && <span className="app-brand-sub">{sub}</span>}
      </span>
    </>
  );

  return (
    <header className="app-header">
      <div className="app-header-left">
        {left}
        {onBrandClick ? (
          <button className="app-brand" type="button" onClick={onBrandClick}>
            {brand}
          </button>
        ) : (
          <div className="app-brand">{brand}</div>
        )}
      </div>

      <div className="app-header-center">{nav}</div>

      <div className="app-header-right">
        <button
          className="app-header-icon"
          type="button"
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        {children}
      </div>
    </header>
  );
}
