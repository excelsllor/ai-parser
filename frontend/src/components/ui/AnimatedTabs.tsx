import type { ReactNode } from 'react';

import { cx } from '@utils/cx';
import { useTabIndicator } from '@utils/useTabIndicator';

import styles from './AnimatedTabs.module.css';

export interface AnimatedTabsItem<T extends string> {
  id: T;
  label: ReactNode;
}

interface AnimatedTabsProps<T extends string> {
  items: Array<AnimatedTabsItem<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export default function AnimatedTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  size = 'md',
}: AnimatedTabsProps<T>) {
  const { containerRef, indicator } = useTabIndicator<HTMLDivElement>(value);

  return (
    <div
      ref={containerRef}
      className={cx(styles, `tabs tabs--${size}`, className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      <span
        className={cx(styles, 'tabs-indicator')}
        style={{
          width: indicator.width,
          height: indicator.height,
          opacity: indicator.visible ? 1 : 0,
          transform: `translate(${indicator.left}px, ${indicator.top}px)`,
        }}
      />
      {items.map((item) => (
        <button
          className={cx(styles, 'tabs-button')}
          data-tab-active={item.id === value}
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
