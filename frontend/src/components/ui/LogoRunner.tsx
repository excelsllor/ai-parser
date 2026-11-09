import { cx } from '@utils/cx';

import styles from './LogoRunner.module.css';

interface LogoRunnerProps {
  message?: string;
  hint?: string;
}

export default function LogoRunner({
  message = 'Формируем дайджест…',
  hint,
}: LogoRunnerProps) {
  return (
    <div className={cx(styles, 'logo-runner')} role="status" aria-live="polite">
      <div className={cx(styles, 'logo-runner-stage')} aria-hidden="true">
        <span className={cx(styles, 'logo-runner-ground')} />
        <img
          className={cx(styles, 'logo-runner-sprite')}
          src="/icons/logo.svg"
          alt=""
        />
        <span className={cx(styles, 'logo-runner-obstacle logo-runner-obstacle--one')} />
        <span className={cx(styles, 'logo-runner-obstacle logo-runner-obstacle--two')} />
      </div>
      <div className={cx(styles, 'logo-runner-copy')}>
        <strong>{message}</strong>
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}
