import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  AlertCircleIcon,
  CheckCircleIcon,
  CloseIcon,
  InfoIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

import { ToastContext } from './toast';
import type { ToastType } from './toast';
import styles from './ToastContext.module.css';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

const ICONS = {
  success: CheckCircleIcon,
  error: AlertCircleIcon,
  info: InfoIcon,
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((type: ToastType, message: string) => {
    const id = nextId;
    nextId += 1;
    setToasts((current) => [...current.slice(-3), { id, type, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={cx(styles, 'toast-viewport')} aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          return (
            <div
              className={cx(styles, `toast toast--${toast.type}`)}
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
            >
              <Icon className={cx(styles, 'toast-icon')} />
              <span className={cx(styles, 'toast-text')}>{toast.message}</span>
              <button
                className={cx(styles, 'toast-close')}
                type="button"
                aria-label="Закрыть сообщение"
                onClick={() =>
                  setToasts((current) =>
                    current.filter((item) => item.id !== toast.id),
                  )
                }
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
