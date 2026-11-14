import { Fragment } from 'react';
import type { ReactNode } from 'react';

import { cx } from '@utils/cx';

import styles from './LinkifiedText.module.css';

const LINK_PATTERN =
  /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s;,)]+)/g;

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

export default function LinkifiedText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(<Fragment key={`text-${last}`}>{text.slice(last, index)}</Fragment>);
    }
    const url = match[2] ?? match[3];
    const label = hostOf(url);
    nodes.push(
      <a
        className={cx(styles, 'link')}
        href={url}
        key={`link-${index}-${url}`}
        rel="noreferrer"
        target="_blank"
      >
        {label}
      </a>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={`text-${last}`}>{text.slice(last)}</Fragment>);
  }
  return <>{nodes}</>;
}
