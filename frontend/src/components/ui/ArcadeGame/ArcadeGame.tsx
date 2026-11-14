import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { cx } from '@utils/cx';
import { readBestScore, saveBestScore } from '@utils/gameScores';
import type { GameId } from '@utils/gameScores';

import { ARCADE_GAME_LABELS } from './arcadeGames';
import type { ArcadeGameId } from './arcadeGames';
import { setupSnake } from './games/snake';
import { setupDino } from './games/dino';
import { setup2048 } from './games/game2048';
import { setupArkanoid } from './games/arkanoid';
import { setupFlappy } from './games/flappy';
import { setupPong } from './games/pong';
import { setupTetris } from './games/tetris';
import { setupTicTacToe } from './games/tictactoe';
import { setupWordle } from './games/wordle';
import { CANVAS_SCALE, HEIGHT, LOGO, WIDTH } from './shared';
import type { ArcadeGameProps, Setup } from './types';
import styles from './ArcadeGame.module.css';

const SETUPS: Record<ArcadeGameId, Setup> = {
  snake: setupSnake,
  dino: setupDino,
  '2048': setup2048,
  arkanoid: setupArkanoid,
  flappy: setupFlappy,
  pong: setupPong,
  tetris: setupTetris,
  tictactoe: setupTicTacToe,
  wordle: setupWordle,
};

export default function ArcadeGame({
  game,
  message = 'Формируем дайджест…',
  hint,
  autoPlay,
  onAutoPlayChange,
}: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoPlayRef = useRef(true);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBestScore(game));
  const scoreRef = useRef(0);
  const bestRef = useRef(best);
  const [autoPlaying, setAutoPlaying] = useState(true);
  const [match, setMatch] = useState<string | null>(null);

  const updateScore = useCallback<Dispatch<SetStateAction<number>>>(
    (value) => {
      const next = typeof value === 'function' ? value(scoreRef.current) : value;
      scoreRef.current = next;
      setScore(next);
      if (next > bestRef.current) {
        bestRef.current = next;
        setBest(next);
        saveBestScore(game as GameId, next);
      }
    },
    [game],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAutoPlaying(autoPlayRef.current);
    }, 200);
    return () => window.clearInterval(timer);
  }, [game]);

  useEffect(() => {
    if (autoPlay === undefined) {
      return;
    }
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    onAutoPlayChange?.(autoPlaying);
  }, [autoPlaying, onAutoPlayChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    const logo = new Image();
    logo.src = LOGO;
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);
    return SETUPS[game]({ ctx, logo, autoPlayRef, setScore: updateScore, setMatch });
  }, [game, updateScore]);

  return (
    <div className={cx(styles, 'arcade-game')} role="status" aria-live="polite">
      <div className={cx(styles, 'arcade-hud')}>
        <span>
          <em>Счёт</em>
          <strong>{score}</strong>
        </span>
        {match && (
          <span className={cx(styles, 'arcade-hud-match')}>
            <em>Матч</em>
            <strong>{match}</strong>
          </span>
        )}
        <span>
          <em>Рекорд</em>
          <strong>{best}</strong>
        </span>
      </div>
      <div className={cx(styles, 'arcade-stage')}>
        <canvas
          ref={canvasRef}
          className={cx(styles, 'arcade-canvas')}
          width={WIDTH * CANVAS_SCALE}
          height={HEIGHT[game] * CANVAS_SCALE}
          aria-label={`Мини-игра: ${ARCADE_GAME_LABELS[game]}`}
        />
      </div>
      <div className={cx(styles, 'arcade-copy')}>
        {message && <strong>{message}</strong>}
        {hint ? <span>{hint}</span> : null}
      </div>
    </div>
  );
}
