import type { ReactNode } from 'react';

import { cx } from '@utils/cx';

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

      <div className={cx(styles, 'format-guide-formats')}>
        {formats.map((format) => (
          <button
            aria-pressed={value === format.id}
            key={format.id}
            type="button"
            onClick={() => onChange(format.id)}
          >
            {format.label}
          </button>
        ))}
      </div>

      {targets && targets.length > 0 && (
        <div className={cx(styles, 'format-guide-targets')}>
          {targets.map((item) => (
            <button
              aria-pressed={target === item.id}
              key={item.id}
              type="button"
              onClick={() => onTargetChange?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <pre className={cx(styles, 'format-guide-sample')}>{example}</pre>
      {note && <p className={cx(styles, 'format-guide-note')}>{note}</p>}
    </details>
  );
}
