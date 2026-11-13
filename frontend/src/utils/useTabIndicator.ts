import { useLayoutEffect, useRef, useState } from 'react';

export interface TabIndicator {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

const EMPTY: TabIndicator = { left: 0, top: 0, width: 0, height: 0, visible: false };

export function useTabIndicator<T extends HTMLElement>(active: string | number | null) {
  const containerRef = useRef<T>(null);
  const [indicator, setIndicator] = useState<TabIndicator>(EMPTY);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const update = () => {
      const node = container.querySelector<HTMLElement>('[data-tab-active="true"]');
      if (!node) {
        setIndicator(EMPTY);
        return;
      }
      setIndicator({
        left: node.offsetLeft,
        top: node.offsetTop,
        width: node.offsetWidth,
        height: node.offsetHeight,
        visible: true,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [active]);

  return { containerRef, indicator };
}
