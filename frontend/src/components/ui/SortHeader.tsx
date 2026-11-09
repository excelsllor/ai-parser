import type { ReactNode } from 'react';

import type { SortDirection } from '@utils/sort';
import { cx } from '@utils/cx';

import styles from './SortHeader.module.css';

interface SortHeaderProps {
  label: ReactNode;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}

export default function SortHeader({
  label,
  active,
  direction,
  onClick,
}: SortHeaderProps) {
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className={cx(styles, 'sort-button')} type="button" onClick={onClick}>
        {label}
        <span className={cx(styles, 'sort-arrow')} aria-hidden="true">
          {active ? (direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}
