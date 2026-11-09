import { useEffect, useRef, useState } from 'react';

import { cx } from '@utils/cx';

import styles from './LogoRunner.module.css';

interface LogoRunnerProps {
  message?: string;
  hint?: string;
}

interface Obstacle {
  x: number;
  width: number;
  height: number;
  passed: boolean;
}

const WIDTH = 280;
const HEIGHT = 140;
const GROUND = 112;
const RUNNER_X = 38;
const RUNNER_SIZE = 34;
const GRAVITY = 0.55;
const JUMP_VELOCITY = -7.6;
const START_SPEED = 2.6;

export default function LogoRunner({
  message = 'Формируем дайджест…',
  hint,
}: LogoRunnerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoPlayRef = useRef(true);
  const [score, setScore] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(true);
  const [gameOver, setGameOver] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const logo = new Image();
    logo.src = '/icons/logo.svg';

    let runnerY = GROUND - RUNNER_SIZE;
    let velocity = 0;
    let obstacles: Obstacle[] = [];
    let spawnIn = 900;
    let speed = START_SPEED;
    let elapsed = 0;
    let last = performance.now();
    let over = false;

    const jump = () => {
      if (over) {
        reset();
        return;
      }
      if (runnerY >= GROUND - RUNNER_SIZE - 0.5) {
        velocity = JUMP_VELOCITY;
      }
    };

    const reset = () => {
      runnerY = GROUND - RUNNER_SIZE;
      velocity = 0;
      obstacles = [];
      spawnIn = 700;
      speed = START_SPEED;
      elapsed = 0;
      over = false;
      setGameOver(false);
      setScore(0);
    };

    const crash = () => {
      over = true;
      setGameOver(true);
    };

    const spawn = () => {
      const height = 22 + Math.round(Math.random() * 14);
      obstacles.push({
        x: WIDTH + 10,
        width: 13 + Math.round(Math.random() * 8),
        height,
        passed: false,
      });
      spawnIn = 900 + Math.random() * 700 - speed * 60;
    };

    const intersects = (obstacle: Obstacle) =>
      RUNNER_X + 5 < obstacle.x + obstacle.width &&
      RUNNER_X + RUNNER_SIZE - 5 > obstacle.x &&
      runnerY + 5 < GROUND &&
      runnerY + RUNNER_SIZE - 4 > GROUND - obstacle.height;

    const update = (delta: number) => {
      if (over) {
        return;
      }
      const step = delta / 16.67;
      elapsed += delta;
      speed = START_SPEED + Math.min(2.4, elapsed / 12000);

      velocity += GRAVITY * step;
      runnerY = Math.min(GROUND - RUNNER_SIZE, runnerY + velocity * step);

      spawnIn -= delta;
      if (spawnIn <= 0) {
        spawn();
      }

      for (const obstacle of obstacles) {
        obstacle.x -= speed * step;
        if (!obstacle.passed && obstacle.x + obstacle.width < RUNNER_X) {
          obstacle.passed = true;
          setScore((value) => value + 1);
        }
      }
      obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -10);

      if (autoPlayRef.current) {
        const next = obstacles
          .filter((obstacle) => obstacle.x + obstacle.width > RUNNER_X)
          .sort((left, right) => left.x - right.x)[0];
        if (next && next.x - RUNNER_X < 58 && runnerY >= GROUND - RUNNER_SIZE - 0.5) {
          velocity = JUMP_VELOCITY;
        }
      }

      if (obstacles.some(intersects)) {
        crash();
      }
    };

    const draw = () => {
      context.clearRect(0, 0, WIDTH, HEIGHT);

      context.strokeStyle = '#94a3b8';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, GROUND + 1);
      context.lineTo(WIDTH, GROUND + 1);
      context.stroke();

      context.fillStyle = '#2563eb';
      for (const obstacle of obstacles) {
        context.fillRect(
          obstacle.x,
          GROUND - obstacle.height,
          obstacle.width,
          obstacle.height,
        );
      }

      if (logo.complete && logo.naturalWidth > 0) {
        context.drawImage(
          logo,
          RUNNER_X,
          runnerY,
          RUNNER_SIZE,
          RUNNER_SIZE,
        );
      } else {
        context.fillStyle = '#7c3aed';
        context.fillRect(RUNNER_X, runnerY, RUNNER_SIZE, RUNNER_SIZE);
      }
    };

    let frame = 0;
    const loop = (now: number) => {
      const delta = Math.min(48, now - last);
      last = now;
      update(delta);
      draw();
      frame = window.requestAnimationFrame(loop);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (![' ', 'Spacebar', 'ArrowUp'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      autoPlayRef.current = false;
      setAutoPlaying(false);
      jump();
    };

    const onClick = () => {
      autoPlayRef.current = false;
      setAutoPlaying(false);
      jump();
    };

    canvas.addEventListener('pointerdown', onClick);
    window.addEventListener('keydown', onKeyDown);
    frame = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('pointerdown', onClick);
    };
  }, []);

  return (
    <div className={cx(styles, 'logo-runner')} role="status" aria-live="polite">
      <div className={cx(styles, 'logo-runner-stage')}>
        <canvas
          ref={canvasRef}
          className={cx(styles, 'logo-runner-canvas')}
          width={WIDTH}
          height={HEIGHT}
          aria-label="Мини-игра: логотип перепрыгивает препятствия"
        />
        {gameOver && (
          <div className={cx(styles, 'logo-runner-overlay')}>
            <strong>Игра окончена</strong>
            <span>Пробел или тап — заново</span>
          </div>
        )}
      </div>
      <div className={cx(styles, 'logo-runner-copy')}>
        <strong>{message}</strong>
        {hint && <span>{hint}</span>}
        <span className={cx(styles, 'logo-runner-score')}>
          Счёт: {score} ·{' '}
          {gameOver
            ? 'Столкновение'
            : autoPlaying
              ? 'Автоигра · пробел или тап, чтобы играть'
              : 'Пробел / стрелка вверх / тап — прыжок'}
        </span>
      </div>
    </div>
  );
}
