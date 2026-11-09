import { Fragment } from 'react';

import { cx } from '@utils/cx';

import styles from './LinkifiedText.module.css';

const URL_PATTERN = /(https?:\/\/[^\s;,)]+)/g;

export default function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            className={cx(styles, 'link')}
            href={part}
            key={`${part}-${index}`}
            rel="noreferrer"
            target="_blank"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
