import { useState } from 'react';

import {
  AppHeader,
  ArcadeGame,
  ARCADE_GAME_CONTROLS,
  ARCADE_GAME_IDS,
  ARCADE_GAME_LABELS,
} from '@components';
import type { ArcadeGameId } from '@components';
import { cx } from '@utils/cx';
import { useTabIndicator } from '@utils/useTabIndicator';

import workspaceStyles from '@components/workspace/workspace.module.css';
import gamesStyles from './GamesPage.module.css';

const styles = { ...workspaceStyles, ...gamesStyles };

export default function GamesPage() {
  const [game, setGame] = useState<ArcadeGameId | null>(null);
  const [autoPlaying, setAutoPlaying] = useState(true);
  const { containerRef, indicator } = useTabIndicator<HTMLDivElement>(game);

  return (
    <div className={cx(styles, 'ws-page games-page')}>
      <AppHeader badge="Play" />
      <main className={cx(styles, 'games-main')}>
        <header className={cx(styles, 'games-head')}>
          <span className={cx(styles, 'games-eyebrow')}>ИГРЫ</span>
          <h1>Пока дайджест собирается</h1>
          <p>
            Выберите игру. Все работают сами, но можно перехватить управление.
          </p>
        </header>

        <div
          className={cx(styles, 'games-switch')}
          ref={containerRef}
          role="tablist"
          aria-label="Выбор игры"
        >
          <span
            aria-hidden="true"
            className={cx(styles, 'games-switch-indicator')}
            style={{
              width: indicator.width,
              height: indicator.height,
              opacity: indicator.visible ? 1 : 0,
              transform: `translate(${indicator.left}px, ${indicator.top}px)`,
            }}
          />
          {ARCADE_GAME_IDS.map((value) => (
            <button
              className={cx(styles, `games-switch-button${game === value ? ' games-switch-button--active' : ''}`)}
              key={value}
              type="button"
              role="tab"
              aria-selected={game === value}
              data-tab-active={game === value}
              onClick={() => {
                setAutoPlaying(true);
                setGame(value);
              }}
            >
              {ARCADE_GAME_LABELS[value]}
            </button>
          ))}
        </div>

        {game === null ? (
          <p className={cx(styles, 'games-empty')}>Выберите игру — она запустится сразу.</p>
        ) : (
          <section className={cx(styles, 'games-card')} key={game}>
            <div className={cx(styles, 'games-card-head')}>
              <h2>{ARCADE_GAME_LABELS[game]}</h2>
              <div className={cx(styles, 'games-card-tools')}>
                <button
                  type="button"
                  aria-pressed={autoPlaying}
                  className={cx(
                    styles,
                    `games-autoplay${autoPlaying ? ' games-autoplay--on' : ''}`,
                  )}
                  onClick={() => setAutoPlaying((value) => !value)}
                >
                  <span className={cx(styles, 'games-autoplay-dot')} aria-hidden="true" />
                  {autoPlaying ? 'Автоигра' : 'Управление'}
                </button>
                <span className={cx(styles, 'games-card-controls')}>
                  Управление: {ARCADE_GAME_CONTROLS[game]}
                </span>
              </div>
            </div>
            <ArcadeGame
              game={game}
              message=""
              hint="Играет сама, но управление можно перехватить."
              autoPlay={autoPlaying}
              onAutoPlayChange={setAutoPlaying}
            />
          </section>
        )}
      </main>
    </div>
  );
}
