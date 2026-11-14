import type { ReactNode } from 'react';

import { cx } from '@utils/cx';

import AnimatedTabs from './AnimatedTabs';
import styles from './FormatGuide.module.css';

export interface FormatGuideOption {
  id: string;
  label: string;
  example: string;
}

export interface FormatGuideTarget {
  id: string;
  label: string;
}

interface FormatGuideProps {
  title: string;
  subtitle?: string;
  formats: FormatGuideOption[];
  value: string;
  onChange: (value: string) => void;
  note?: ReactNode;
  targets?: FormatGuideTarget[];
  target?: string;
  onTargetChange?: (value: string) => void;
  className?: string;
}

export default function FormatGuide({
  title,
  subtitle,
  formats,
  value,
  onChange,
  note,
  targets,
  target,
  onTargetChange,
  className,
}: FormatGuideProps) {
  const example = formats.find((format) => format.id === value)?.example ?? '';

  return (
    <details className={cx(styles, 'format-guide', className)}>
      <summary className={cx(styles, 'format-guide-summary')}>
        <div className={cx(styles, 'format-guide-heading')}>
          <h2 className={cx(styles, 'format-guide-title')}>{title}</h2>
          {subtitle && <p className={cx(styles, 'format-guide-subtitle')}>{subtitle}</p>}
        </div>
        <span className={cx(styles, 'format-guide-badge')}>
          {formats.map((format) => format.label).join(' · ')}
        </span>
        <span className={cx(styles, 'format-guide-chevron')} aria-hidden="true">
          ▾
        </span>
      </summary>

      <AnimatedTabs
        className={cx(styles, 'format-guide-formats')}
        items={formats.map((format) => ({ id: format.id, label: format.label }))}
        value={value}
        onChange={onChange}
        size="sm"
        ariaLabel={title}
      />

      {targets && targets.length > 0 && (
        <AnimatedTabs
          className={cx(styles, 'format-guide-targets')}
          items={targets.map((item) => ({ id: item.id, label: item.label }))}
          value={target ?? ''}
          onChange={(next) => onTargetChange?.(next)}
          size="sm"
          ariaLabel="Формат"
        />
      )}

      <pre className={cx(styles, 'format-guide-sample')}>{example}</pre>
      {note && <p className={cx(styles, 'format-guide-note')}>{note}</p>}
    </details>
  );
}
