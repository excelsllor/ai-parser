import { useEffect, useRef, useState } from 'react';

import './SnakeLoader.css';

interface SnakeLoaderProps {
  message?: string;
  hint?: string;
}

interface Point {
  x: number;
  y: number;
}

const COLS = 20;
const ROWS = 10;
const CELL = 28;
const TICK_MS = 130;

// Food sprites: the logo invader plus simple error/warning/info/success glyphs.
const INVADER = [
  '...........',
  '...X...X...',
  '....X.X....',
  '.X.XXXXX.X.',
  '.XXX.X.XXX.',
  '...X.X.X...',
  '.X.XXXXX.X.',
  '.XX.XXX.XX.',
  '....XXX....',
  '....X.X....',
  '...........',
];

type FoodKind = 'bug' | 'error' | 'warning';

interface Food extends Point {
  kind: FoodKind;
}

const FOOD_KINDS: FoodKind[] = ['bug', 'error', 'warning'];

const FOOD_COLORS: Record<FoodKind, string> = {
  bug: '#B347FF',
  error: '#ef4444',
  warning: '#f59e0b',
};

function randomFood(snake: Point[]): Food {
  let next: Food;
  do {
    next = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
      kind: FOOD_KINDS[Math.floor(Math.random() * FOOD_KINDS.length)],
    };
  } while (snake.some((segment) => segment.x === next.x && segment.y === next.y));
  return next;
}

function drawRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  const r = Math.min(radius, size / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + size, y, x + size, y + size, r);
  context.arcTo(x + size, y + size, x, y + size, r);
  context.arcTo(x, y + size, x, y, r);
  context.arcTo(x, y, x + size, y, r);
  context.closePath();
}

export default function SnakeLoader({
  message = 'Формируем дайджест…',
  hint,
}: SnakeLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoPlayRef = useRef(true);
  const [score, setScore] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const headColor = '#86efac';
    const bodyColor = '#22c55e';

    let snake: Point[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ];
    let direction: Point = { x: 1, y: 0 };
    let queuedDirection: Point = { x: 1, y: 0 };
    let food = randomFood(snake);
    let lastInputAt = 0;

    const chooseAutoDirection = (): Point => {
      const head = snake[0];
      const candidates = [
        { x: 0, y: -1 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ].filter(
        (candidate) =>
          !(candidate.x === -direction.x && candidate.y === -direction.y),
      );

      const safe = candidates.filter((candidate) => {
        const next = { x: head.x + candidate.x, y: head.y + candidate.y };
        return (
          next.x >= 0 &&
          next.x < COLS &&
          next.y >= 0 &&
          next.y < ROWS &&
          !snake.some((segment) => segment.x === next.x && segment.y === next.y)
        );
      });

      if (safe.length === 0) {
        return direction;
      }

      return safe.sort((left, right) => {
        const leftDistance =
          Math.abs(head.x + left.x - food.x) + Math.abs(head.y + left.y - food.y);
        const rightDistance =
          Math.abs(head.x + right.x - food.x) + Math.abs(head.y + right.y - food.y);
        return leftDistance - rightDistance;
      })[0];
    };

    const drawFood = () => {
      const color = FOOD_COLORS[food.kind];
      const cx = food.x * CELL + CELL / 2;
      const cy = food.y * CELL + CELL / 2;

      context.save();
      context.shadowColor = color;
      context.shadowBlur = 10;
      context.fillStyle = color;

      if (food.kind === 'bug') {
        const pixel = CELL / 11;
        INVADER.forEach((row, py) => {
          for (let px = 0; px < row.length; px += 1) {
            if (row[px] === 'X') {
              context.fillRect(
                food.x * CELL + px * pixel,
                food.y * CELL + py * pixel,
                pixel,
                pixel,
              );
            }
          }
        });
        context.restore();
        return;
      }

      context.beginPath();
      if (food.kind === 'warning') {
        context.moveTo(cx, cy - 10);
        context.lineTo(cx + 10, cy + 8);
        context.lineTo(cx - 10, cy + 8);
        context.closePath();
      } else {
        context.arc(cx, cy, 10, 0, Math.PI * 2);
      }
      context.fill();
      context.shadowBlur = 0;

      context.fillStyle = '#ffffff';
      context.fillRect(cx - 1.4, cy - 6.5, 2.8, 7.5);
      context.fillRect(cx - 1.4, cy + 3, 2.8, 2.8);

      context.restore();
    };

    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);

      drawFood();

      snake.forEach((segment, index) => {
        const padding = index === 0 ? 4 : 6;
        context.fillStyle =
          index === 0
            ? headColor
            : `rgba(34, 197, 94, ${Math.max(0.35, 1 - index * 0.12)})`;
        if (index === 0) {
          context.save();
          context.shadowColor = bodyColor;
          context.shadowBlur = 12;
        }
        drawRoundRect(
          context,
          segment.x * CELL + padding,
          segment.y * CELL + padding,
          CELL - padding * 2,
          4,
        );
        context.fill();
        if (index === 0) {
          context.restore();
        }
      });
    };

    const reset = () => {
      snake = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ];
      direction = { x: 1, y: 0 };
      queuedDirection = { x: 1, y: 0 };
      food = randomFood(snake);
      setScore(0);
      draw();
    };

    const crash = () => {
      reset();
    };

    const tick = () => {
      if (!autoPlayRef.current && Date.now() - lastInputAt > 4000) {
        autoPlayRef.current = true;
        setAutoPlaying(true);
      }
      direction = autoPlayRef.current ? chooseAutoDirection() : queuedDirection;
      const head = snake[0];
      const next = { x: head.x + direction.x, y: head.y + direction.y };

      if (
        next.x < 0 ||
        next.x >= COLS ||
        next.y < 0 ||
        next.y >= ROWS ||
        snake.some((segment) => segment.x === next.x && segment.y === next.y)
      ) {
        crash();
        return;
      }

      snake = [next, ...snake];
      if (next.x === food.x && next.y === food.y) {
        setScore((value) => value + 1);
        food = randomFood(snake);
      } else {
        snake.pop();
      }

      draw();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        return;
      }

      event.preventDefault();
      lastInputAt = Date.now();
      autoPlayRef.current = false;
      setAutoPlaying(false);
      const next =
        key === 'ArrowUp'
          ? { x: 0, y: -1 }
          : key === 'ArrowDown'
            ? { x: 0, y: 1 }
            : key === 'ArrowLeft'
              ? { x: -1, y: 0 }
              : { x: 1, y: 0 };

      if (next.x === -direction.x && next.y === -direction.y) {
        return;
      }
      queuedDirection = next;
    };

    draw();
    const timer = window.setInterval(tick, TICK_MS);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="snake-loader" role="status" aria-live="polite">
      <div className="snake-loader-stage">
        <div className="snake-loader-grid" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="snake-canvas"
          width={COLS * CELL}
          height={ROWS * CELL}
          aria-label="Мини-игра Змейка"
        />
      </div>
      <div className="snake-loader-copy">
        <strong>{message}</strong>
        {hint && <span>{hint}</span>}
        <span className="snake-score">
          Счёт: {score} ·{' '}
          {autoPlaying ? 'Автоигра · нажмите стрелку, чтобы управлять' : 'Стрелки — управление'}
        </span>
      </div>
    </div>
  );
}
