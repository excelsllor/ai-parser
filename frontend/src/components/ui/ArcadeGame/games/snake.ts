import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect } from '../shared';

export function setupSnake({ ctx, autoPlayRef, setScore }: GameContext): () => void {
  interface Point {
    x: number;
    y: number;
  }
  type FoodKind = 'bug' | 'error' | 'warning';
  interface Food extends Point {
    kind: FoodKind;
  }

  const COLS = 20;
  const ROWS = 10;
  const CELL = 16;
  const TICK = 130;
  const originX = (WIDTH - COLS * CELL) / 2;
  const originY = (HEIGHT.snake - ROWS * CELL) / 2;
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
  const FOOD_KINDS: FoodKind[] = ['bug', 'error', 'warning'];
  const FOOD_COLORS: Record<FoodKind, string> = {
    bug: '#B347FF',
    error: '#ef4444',
    warning: '#f59e0b',
  };

  const randomFood = (body: Point[]): Food => {
    let next: Food;
    do {
      next = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
        kind: FOOD_KINDS[Math.floor(Math.random() * FOOD_KINDS.length)],
      };
    } while (body.some((segment) => segment.x === next.x && segment.y === next.y));
    return next;
  };

  let snake: Point[] = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ];
  let direction: Point = { x: 1, y: 0 };
  let queuedDirection: Point = { x: 1, y: 0 };
  let food = randomFood(snake);
  let lastInputAt = 0;
  setScore(0);

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

  const drawGrid = () => {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    for (let col = 0; col <= COLS; col += 1) {
      ctx.beginPath();
      ctx.moveTo(originX + col * CELL, originY);
      ctx.lineTo(originX + col * CELL, originY + ROWS * CELL);
      ctx.stroke();
    }
    for (let row = 0; row <= ROWS; row += 1) {
      ctx.beginPath();
      ctx.moveTo(originX, originY + row * CELL);
      ctx.lineTo(originX + COLS * CELL, originY + row * CELL);
      ctx.stroke();
    }
  };

  const drawFood = () => {
    const color = FOOD_COLORS[food.kind];
    const cx = originX + food.x * CELL + CELL / 2;
    const cy = originY + food.y * CELL + CELL / 2;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;

    if (food.kind === 'bug') {
      const pixel = CELL / 11;
      INVADER.forEach((row, py) => {
        for (let px = 0; px < row.length; px += 1) {
          if (row[px] === 'X') {
            ctx.fillRect(
              originX + food.x * CELL + px * pixel,
              originY + food.y * CELL + py * pixel,
              pixel,
              pixel,
            );
          }
        }
      });
      ctx.restore();
      return;
    }

    ctx.beginPath();
    if (food.kind === 'warning') {
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 6, cy + 4);
      ctx.lineTo(cx - 6, cy + 4);
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 1, cy - 4, 2, 4.5);
    ctx.fillRect(cx - 1, cy + 1.5, 2, 2);

    ctx.restore();
  };

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.snake);
    drawGrid();
    drawFood();

    snake.forEach((segment, index) => {
      const padding = index === 0 ? 2 : 3;
      ctx.fillStyle =
        index === 0
          ? '#86efac'
          : `rgba(34, 197, 94, ${Math.max(0.35, 1 - index * 0.12)})`;
      if (index === 0) {
        ctx.save();
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 10;
      }
      roundRect(
        ctx,
        originX + segment.x * CELL + padding,
        originY + segment.y * CELL + padding,
        CELL - padding * 2,
        CELL - padding * 2,
        3,
      );
      ctx.fill();
      if (index === 0) {
        ctx.restore();
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
    // Keep the game alive instead of idling.
    autoPlayRef.current = true;
    reset();
  };

  const tick = () => {
    if (!autoPlayRef.current && Date.now() - lastInputAt > 4000) {
      autoPlayRef.current = true;
    }
    direction = autoPlayRef.current ? chooseAutoDirection() : queuedDirection;
    const head = snake[0];
    const next = {
      x: (head.x + direction.x + COLS) % COLS,
      y: (head.y + direction.y + ROWS) % ROWS,
    };

    if (snake.some((segment) => segment.x === next.x && segment.y === next.y)) {
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
  const timer = window.setInterval(tick, TICK);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('keydown', onKeyDown);
  };
}
