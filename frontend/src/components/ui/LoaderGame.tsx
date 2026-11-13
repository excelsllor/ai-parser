import { useState } from 'react';

import { cx } from '@utils/cx';
import { useTabIndicator } from '@utils/useTabIndicator';

import ArcadeGame, { ARCADE_GAME_IDS, ARCADE_GAME_LABELS } from './ArcadeGame';
import type { ArcadeGameId } from './ArcadeGame';
import styles from './LoaderGame.module.css';

interface LoaderGameProps {
  message?: string;
  hint?: string;
}

export default function LoaderGame({ message, hint }: LoaderGameProps) {
  const [game, setGame] = useState<ArcadeGameId>('snake');
  const [autoPlaying, setAutoPlaying] = useState(true);
  const { containerRef, indicator } = useTabIndicator<HTMLDivElement>(game);

  return (
    <div className={cx(styles, 'loader-game')}>
      <div className={cx(styles, 'loader-game-bar')}>
        <div
          className={cx(styles, 'loader-game-tabs')}
          ref={containerRef}
          role="tablist"
          aria-label="Выбор игры"
        >
          <span
            aria-hidden="true"
            className={cx(styles, 'loader-game-tab-indicator')}
            style={{
              width: indicator.width,
              height: indicator.height,
              opacity: indicator.visible ? 1 : 0,
              transform: `translate(${indicator.left}px, ${indicator.top}px)`,
            }}
          />
          {ARCADE_GAME_IDS.map((value) => (
            <button
              className={cx(
                styles,
                `loader-game-tab${game === value ? ' loader-game-tab--active' : ''}`,
              )}
              data-tab-active={game === value}
              key={value}
              type="button"
              role="tab"
              aria-selected={game === value}
              onClick={() => {
                setAutoPlaying(true);
                setGame(value);
              }}
            >
              {ARCADE_GAME_LABELS[value]}
            </button>
          ))}
        </div>
        <button
          aria-pressed={autoPlaying}
          className={cx(
            styles,
            `loader-game-autoplay${autoPlaying ? ' loader-game-autoplay--on' : ''}`,
          )}
          type="button"
          onClick={() => setAutoPlaying((value) => !value)}
        >
          <span className={cx(styles, 'loader-game-dot')} aria-hidden="true" />
          {autoPlaying ? 'Автоигра' : 'Управление'}
        </button>
      </div>
      <ArcadeGame
        key={game}
        game={game}
        message={message}
        hint={hint}
        autoPlay={autoPlaying}
        onAutoPlayChange={setAutoPlaying}
      />
    </div>
  );
}
