import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'light' | 'dark';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

let themeTransitionSequence = 0;

function readInitialTheme(): Theme {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') {
    return 'dark';
  }

  try {
    return window.localStorage.getItem('cd_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('cd_theme', theme);
    } catch {
      // Storage can be unavailable in private mode.
    }
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    const viewTransitionDocument = document as ViewTransitionDocument;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const applyTheme = () => {
      root.dataset.theme = nextTheme;
      setTheme(nextTheme);
    };

    if (reduceMotion || !viewTransitionDocument.startViewTransition) {
      flushSync(applyTheme);
      return;
    }

    const transitionId = String(++themeTransitionSequence);
    root.dataset.themeTransition = transitionId;
    const transition = viewTransitionDocument.startViewTransition(() => {
      flushSync(applyTheme);
    });
    const clearTransition = () => {
      if (root.dataset.themeTransition === transitionId) {
        delete root.dataset.themeTransition;
      }
    };

    void transition.finished.then(clearTransition, clearTransition);
  }

  return { theme, toggleTheme };
}
