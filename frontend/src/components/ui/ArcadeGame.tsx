import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { cx } from '@utils/cx';
import { readBestScore, saveBestScore } from '@utils/gameScores';
import type { GameId } from '@utils/gameScores';

import styles from './ArcadeGame.module.css';

export type ArcadeGameId =
  | 'snake'
  | 'dino'
  | '2048'
  | 'arkanoid'
  | 'flappy'
  | 'pong'
  | 'tetris'
  | 'tictactoe'
  | 'wordle';

export const ARCADE_GAME_IDS: ArcadeGameId[] = [
  'snake',
  'dino',
  '2048',
  'arkanoid',
  'flappy',
  'pong',
  'tetris',
  'tictactoe',
  'wordle',
];

export const ARCADE_GAME_LABELS: Record<ArcadeGameId, string> = {
  snake: 'Змейка',
  dino: 'Кибер-динозаврик',
  '2048': '2048',
  arkanoid: 'Арканоид',
  flappy: 'Flappy-логотип',
  pong: 'Пинг-понг',
  tetris: 'Тетрис',
  tictactoe: 'Крестики-нолики',
  wordle: 'Wordle',
};

export const ARCADE_GAME_CONTROLS: Record<ArcadeGameId, string> = {
  snake: 'Стрелки',
  dino: 'Пробел / тап',
  '2048': 'Стрелки',
  arkanoid: 'Стрелки / мышь',
  flappy: 'Пробел / тап',
  pong: '↑ / ↓',
  tetris: 'Стрелки / пробел',
  tictactoe: 'Клик',
  wordle: 'Клавиатура',
};

interface ArcadeGameProps {
  game: ArcadeGameId;
  message?: string;
  hint?: string;
  autoPlay?: boolean;
  onAutoPlayChange?: (active: boolean) => void;
}

interface GameContext {
  ctx: CanvasRenderingContext2D;
  logo: HTMLImageElement;
  autoPlayRef: MutableRefObject<boolean>;
  setScore: Dispatch<SetStateAction<number>>;
  setMatch?: (value: string | null) => void;
}

type Setup = (context: GameContext) => () => void;

const WIDTH = 320;
const CANVAS_SCALE = 2;
const HEIGHT: Record<ArcadeGameId, number> = {
  snake: 160,
  dino: 160,
  '2048': 260,
  arkanoid: 200,
  flappy: 200,
  pong: 200,
  tetris: 300,
  tictactoe: 250,
  wordle: 340,
};

const LOGO = '/icons/logo.svg';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function bindKeys(
  handler: (event: KeyboardEvent) => void,
  keys: string[],
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!keys.includes(event.key) && !keys.includes(event.code)) {
      return;
    }
    event.preventDefault();
    handler(event);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function pointerX(canvas: HTMLCanvasElement, event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return (event.clientX - rect.left) * (WIDTH / rect.width);
}

function setupSnake({ ctx, autoPlayRef, setScore }: GameContext): () => void {
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

function setupDino({ ctx, logo, autoPlayRef, setScore }: GameContext): () => void {
  interface Obstacle {
    x: number;
    width: number;
    height: number;
    passed: boolean;
  }

  const DW = WIDTH;
  const DH = HEIGHT.dino;
  const GROUND = 128;
  const RUNNER_X = 40;
  const RUNNER_SIZE = 34;
  const GRAVITY = 0.55;
  const JUMP_VELOCITY = -7.6;
  const START_SPEED = 2.6;
  const offsetX = (WIDTH - DW) / 2;
  const offsetY = (HEIGHT.dino - DH) / 2;

  let runnerY = GROUND - RUNNER_SIZE;
  let velocity = 0;
  let obstacles: Obstacle[] = [];
  let spawnIn = 900;
  let speed = START_SPEED;
  let elapsed = 0;
  let last = performance.now();
  let over = false;
  let restartTimer: number | null = null;
  setScore(0);

  const reset = () => {
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    runnerY = GROUND - RUNNER_SIZE;
    velocity = 0;
    obstacles = [];
    spawnIn = 700;
    speed = START_SPEED;
    elapsed = 0;
    over = false;
    setScore(0);
  };

  const crash = () => {
    over = true;
    autoPlayRef.current = true;
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      reset();
    }, 800);
  };

  const jump = () => {
    if (over) {
      reset();
      return;
    }
    if (runnerY >= GROUND - RUNNER_SIZE - 0.5) {
      velocity = JUMP_VELOCITY;
    }
  };

  const spawn = () => {
    const height = 22 + Math.round(Math.random() * 14);
    obstacles.push({
      x: DW + 10,
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
      const framesToImpact =
        next === undefined
          ? Number.POSITIVE_INFINITY
          : (next.x - (RUNNER_X + RUNNER_SIZE)) / Math.max(speed, 0.1);
      if (framesToImpact < 5 && runnerY >= GROUND - RUNNER_SIZE - 0.5) {
        velocity = JUMP_VELOCITY;
      }
    }

    if (obstacles.some(intersects)) {
      crash();
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.dino);
    ctx.save();
    ctx.translate(offsetX, offsetY);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 1);
    ctx.lineTo(DW, GROUND + 1);
    ctx.stroke();

    for (const obstacle of obstacles) {
      const top = GROUND - obstacle.height;
      ctx.save();
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 9;
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(obstacle.x, top, obstacle.width, obstacle.height);
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        obstacle.x + 0.75,
        top + 0.75,
        obstacle.width - 1.5,
        obstacle.height - 1.5,
      );
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
      for (let y = top + 5; y < top + obstacle.height - 3; y += 5) {
        ctx.fillRect(obstacle.x + 3, y, Math.max(3, obstacle.width - 6), 2);
      }

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(obstacle.x + obstacle.width / 2 - 1.5, top + 2, 3, 3);
      ctx.restore();
    }

    if (logo.complete && logo.naturalWidth > 0) {
      ctx.drawImage(logo, RUNNER_X, runnerY, RUNNER_SIZE, RUNNER_SIZE);
    } else {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(RUNNER_X, runnerY, RUNNER_SIZE, RUNNER_SIZE);
    }

    if (over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(0, 0, DW, DH);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Игра окончена', DW / 2, DH / 2);
    }

    ctx.restore();
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
    jump();
  };

  const onClick = () => {
    autoPlayRef.current = false;
    jump();
  };

  ctx.canvas.addEventListener('pointerdown', onClick);
  window.addEventListener('keydown', onKeyDown);
  frame = window.requestAnimationFrame(loop);

  return () => {
    window.cancelAnimationFrame(frame);
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
    }
    ctx.canvas.removeEventListener('pointerdown', onClick);
    window.removeEventListener('keydown', onKeyDown);
  };
}

function setup2048({ ctx, autoPlayRef, setScore }: GameContext): () => void {
  type Grid = number[][];
  type Direction = 'left' | 'right' | 'up' | 'down';
  const size = 4;
  const cell = 56;
  const gap = 6;
  const boardSize = size * cell + (size - 1) * gap;
  const originX = (WIDTH - boardSize) / 2;
  const originY = (HEIGHT['2048'] - boardSize) / 2;

  const emptyGrid = (): Grid =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => 0));

  const spawn = (grid: Grid) => {
    const empty: Array<[number, number]> = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (grid[y][x] === 0) {
          empty.push([x, y]);
        }
      }
    }
    if (empty.length === 0) {
      return false;
    }
    const [x, y] = empty[Math.floor(Math.random() * empty.length)];
    grid[y][x] = Math.random() < 0.9 ? 2 : 4;
    return true;
  };

  interface SlideMove {
    from: number[];
    values: number[];
    to: number;
  }
  interface TileMove {
    value: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }

  const slide = (line: number[]) => {
    const values: Array<{ value: number; index: number }> = [];
    line.forEach((value, index) => {
      if (value !== 0) {
        values.push({ value, index });
      }
    });
    const result: number[] = [];
    const moves: SlideMove[] = [];
    let gained = 0;
    for (let index = 0; index < values.length; index += 1) {
      if (index + 1 < values.length && values[index].value === values[index + 1].value) {
        const merged = values[index].value * 2;
        result.push(merged);
        moves.push({
          from: [values[index].index, values[index + 1].index],
          values: [values[index].value, values[index + 1].value],
          to: result.length - 1,
        });
        gained += merged;
        index += 1;
      } else {
        result.push(values[index].value);
        moves.push({
          from: [values[index].index],
          values: [values[index].value],
          to: result.length - 1,
        });
      }
    }
    while (result.length < size) {
      result.push(0);
    }
    return { line: result, gained, moves };
  };

  const slideGrid = (grid: Grid, direction: Direction) => {
    const next = grid.map((row) => row.slice());
    const tiles: TileMove[] = [];
    let gained = 0;
    let moved = false;
    for (let index = 0; index < size; index += 1) {
      const horizontal = direction === 'left' || direction === 'right';
      const reverse = direction === 'right' || direction === 'down';
      const line = horizontal
        ? next[index].slice()
        : next.map((row) => row[index]);
      const oriented = reverse ? line.slice().reverse() : line;
      const result = slide(oriented);
      const final = reverse ? result.line.slice().reverse() : result.line;
      gained += result.gained;
      for (const move of result.moves) {
        const target = reverse ? size - 1 - move.to : move.to;
        for (const source of move.from) {
          const origin = reverse ? size - 1 - source : source;
          tiles.push({
            value: move.values[move.from.indexOf(source)] ?? move.values[0],
            fromX: horizontal ? origin : index,
            fromY: horizontal ? index : origin,
            toX: horizontal ? target : index,
            toY: horizontal ? index : target,
          });
        }
      }
      for (let offset = 0; offset < size; offset += 1) {
        if (horizontal) {
          if (next[index][offset] !== final[offset]) {
            moved = true;
          }
          next[index][offset] = final[offset];
        } else {
          if (next[offset][index] !== final[offset]) {
            moved = true;
          }
          next[offset][index] = final[offset];
        }
      }
    }
    return { grid: next, gained, moved, tiles };
  };

  const gridValue = (grid: Grid) => grid.flat().reduce((sum, value) => sum + value, 0);
  const emptyCount = (grid: Grid) => grid.flat().filter((value) => value === 0).length;

  let grid = emptyGrid();
  spawn(grid);
  spawn(grid);
  let score = 0;
  let over = false;
  let restartTimer: number | null = null;
  let lastAuto = 0;
  let animation: { tiles: TileMove[]; start: number } | null = null;
  setScore(0);

  const reset = () => {
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    grid = emptyGrid();
    spawn(grid);
    spawn(grid);
    score = 0;
    over = false;
    animation = null;
    setScore(0);
  };

  const apply = (direction: Direction) => {
    if (over) {
      return;
    }
    const result = slideGrid(grid, direction);
    if (!result.moved) {
      return;
    }
    animation = { tiles: result.tiles, start: performance.now() };
    grid = result.grid;
    score += result.gained;
    setScore(score);
    spawn(grid);
  };

  const finish = () => {
    if (over) {
      return;
    }
    over = true;
    restartTimer = window.setTimeout(reset, 1400);
  };

  const chooseMove = () => {
    const directions: Direction[] = ['left', 'up', 'right', 'down'];
    let bestDirection: Direction | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const direction of directions) {
      const result = slideGrid(grid, direction);
      if (!result.moved) {
        continue;
      }
      const value =
        result.gained * 12 +
        emptyCount(result.grid) * 8 +
        Math.log2(gridValue(result.grid) + 1) * 3 +
        Math.random();
      if (value > bestValue) {
        bestValue = value;
        bestDirection = direction;
      }
    }
    if (bestDirection === null) {
      finish();
      return;
    }
    apply(bestDirection);
  };

  const tileColors: Record<number, [string, string]> = {
    2: ['#dbeafe', '#0f172a'],
    4: ['#bfdbfe', '#0f172a'],
    8: ['#93c5fd', '#0f172a'],
    16: ['#60a5fa', '#0f172a'],
    32: ['#3b82f6', '#f8fafc'],
    64: ['#2563eb', '#f8fafc'],
    128: ['#4f46e5', '#f8fafc'],
    256: ['#7c3aed', '#f8fafc'],
    512: ['#9333ea', '#f8fafc'],
    1024: ['#c026d3', '#f8fafc'],
    2048: ['#f59e0b', '#0f172a'],
  };

  const drawTile = (value: number, x: number, y: number) => {
    const [background, foreground] = tileColors[value] ?? ['#f97316', '#f8fafc'];
    ctx.fillStyle = background;
    roundRect(ctx, x, y, cell, cell, 8);
    ctx.fill();
    ctx.fillStyle = foreground;
    ctx.font = `700 ${value >= 1024 ? 17 : 22}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x + cell / 2, y + cell / 2);
  };

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT['2048']);
    ctx.fillStyle = '#0f172a';
    roundRect(ctx, originX - 8, originY - 8, boardSize + 16, boardSize + 16, 14);
    ctx.fill();

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const px = originX + x * (cell + gap);
        const py = originY + y * (cell + gap);
        ctx.fillStyle = '#1e293b';
        roundRect(ctx, px, py, cell, cell, 8);
        ctx.fill();
      }
    }

    const elapsed = animation === null ? Infinity : performance.now() - animation.start;
    if (animation !== null && elapsed < 200) {
      const progress = 1 - (1 - elapsed / 200) ** 3;
      for (const tile of animation.tiles) {
        const fromX = originX + tile.fromX * (cell + gap);
        const fromY = originY + tile.fromY * (cell + gap);
        const toX = originX + tile.toX * (cell + gap);
        const toY = originY + tile.toY * (cell + gap);
        drawTile(
          tile.value,
          fromX + (toX - fromX) * progress,
          fromY + (toY - fromY) * progress,
        );
      }
    } else {
      animation = null;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const value = grid[y][x];
          if (value === 0) {
            continue;
          }
          drawTile(value, originX + x * (cell + gap), originY + y * (cell + gap));
        }
      }
    }

    if (over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT['2048']);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Игра окончена', WIDTH / 2, HEIGHT['2048'] / 2);
    }
  };

  let frame = 0;
  const loop = (now: number) => {
    if (!over && autoPlayRef.current && now - lastAuto > 720) {
      lastAuto = now;
      chooseMove();
    }
    draw();
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const removeKeys = bindKeys((event) => {
    const directions: Record<string, Direction | undefined> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    };
    const direction = directions[event.key];
    if (direction === undefined) {
      return;
    }
    autoPlayRef.current = false;
    apply(direction);
  }, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

  return () => {
    window.cancelAnimationFrame(frame);
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
    }
    removeKeys();
  };
}

function setupArkanoid({
  ctx,
  autoPlayRef,
  setScore,
}: GameContext): () => void {
  const paddleWidth = 58;
  const paddleHeight = 8;
  const paddleY = HEIGHT.arkanoid - 18;
  const brickRows = 4;
  const brickCols = 6;
  const brickWidth = 40;
  const brickHeight = 15;
  const brickGap = 5;
  const brickOriginX = (WIDTH - (brickCols * brickWidth + (brickCols - 1) * brickGap)) / 2;
  const brickOriginY = 26;

  interface Brick {
    x: number;
    y: number;
    alive: boolean;
  }

  let paddleX = (WIDTH - paddleWidth) / 2;
  let ballX = WIDTH / 2;
  let ballY = paddleY - 12;
  let ballVX = 2.1;
  let ballVY = -2.8;
  let bricks: Brick[] = [];
  let score = 0;
  setScore(0);

  const makeBricks = () => {
    bricks = [];
    for (let row = 0; row < brickRows; row += 1) {
      for (let col = 0; col < brickCols; col += 1) {
        bricks.push({
          x: brickOriginX + col * (brickWidth + brickGap),
          y: brickOriginY + row * (brickHeight + brickGap),
          alive: true,
        });
      }
    }
  };

  const resetBall = () => {
    paddleX = (WIDTH - paddleWidth) / 2;
    ballX = WIDTH / 2;
    ballY = paddleY - 12;
    ballVX = (Math.random() < 0.5 ? -1 : 1) * 2.1;
    ballVY = -2.8;
  };

  makeBricks();

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.arkanoid);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, WIDTH, HEIGHT.arkanoid);

    const colors = ['#22d3ee', '#a78bfa', '#34d399', '#f472b6'];
    for (const brick of bricks) {
      if (!brick.alive) {
        continue;
      }
      ctx.fillStyle = colors[Math.floor(brick.y / (brickHeight + brickGap))] ?? '#22d3ee';
      roundRect(ctx, brick.x, brick.y, brickWidth, brickHeight, 4);
      ctx.fill();
    }

    const gradient = ctx.createLinearGradient(paddleX, 0, paddleX + paddleWidth, 0);
    gradient.addColorStop(0, '#22d3ee');
    gradient.addColorStop(1, '#a78bfa');
    ctx.fillStyle = gradient;
    roundRect(ctx, paddleX, paddleY, paddleWidth, paddleHeight, 4);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(ballX, ballY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    const delta = Math.min(40, now - last);
    last = now;
    const step = delta / 16.67;

    if (autoPlayRef.current) {
      paddleX += (ballX - paddleWidth / 2 - paddleX) * Math.min(1, 0.16 * step);
    }
    paddleX = Math.max(6, Math.min(WIDTH - paddleWidth - 6, paddleX));

    ballX += ballVX * step;
    ballY += ballVY * step;

    if (ballX < 6 || ballX > WIDTH - 6) {
      ballVX *= -1;
      ballX = Math.max(6, Math.min(WIDTH - 6, ballX));
    }
    if (ballY < 6) {
      ballVY = Math.abs(ballVY);
      ballY = 6;
    }
    if (
      ballVY > 0 &&
      ballY + 4 >= paddleY &&
      ballY - 4 <= paddleY + paddleHeight &&
      ballX >= paddleX - 3 &&
      ballX <= paddleX + paddleWidth + 3
    ) {
      const hit = (ballX - (paddleX + paddleWidth / 2)) / (paddleWidth / 2);
      ballVX = Math.max(-3.2, Math.min(3.2, hit * 3.2));
      ballVY = -Math.abs(ballVY);
      ballY = paddleY - 5;
    }

    for (const brick of bricks) {
      if (
        brick.alive &&
        ballX + 4 > brick.x &&
        ballX - 4 < brick.x + brickWidth &&
        ballY + 4 > brick.y &&
        ballY - 4 < brick.y + brickHeight
      ) {
        brick.alive = false;
        ballVY *= -1;
        score += 1;
        setScore(score);
        if (score % 4 === 0) {
          ballVX *= 1.04;
          ballVY *= 1.04;
        }
        break;
      }
    }

    if (bricks.every((brick) => !brick.alive)) {
      makeBricks();
      resetBall();
    }

    if (ballY > HEIGHT.arkanoid + 8) {
      resetBall();
    }

    draw();
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const removeKeys = bindKeys((event) => {
    autoPlayRef.current = false;
    if (event.key === 'ArrowLeft') {
      paddleX -= 22;
    } else {
      paddleX += 22;
    }
  }, ['ArrowLeft', 'ArrowRight']);

  const canvas = ctx.canvas;
  const movePaddle = (event: PointerEvent) => {
    autoPlayRef.current = false;
    paddleX = pointerX(canvas, event) - paddleWidth / 2;
  };
  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture?.(event.pointerId);
    movePaddle(event);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', movePaddle);

  return () => {
    window.cancelAnimationFrame(frame);
    removeKeys();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', movePaddle);
  };
}

function setupFlappy({ ctx, logo, autoPlayRef, setScore }: GameContext): () => void {
  interface Pipe {
    x: number;
    gapY: number;
    passed: boolean;
  }

  const birdSize = 30;
  const birdX = 64;
  const ground = HEIGHT.flappy - 10;
  const gap = 100;
  const pipeWidth = 38;
  let birdY = HEIGHT.flappy / 2;
  let velocity = 0;
  let pipes: Pipe[] = [];
  let spawnIn = 900;
  let score = 0;
  let over = false;
  let restartTimer: number | null = null;
  let lastFlap = 0;
  setScore(0);

  const reset = () => {
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    birdY = HEIGHT.flappy / 2;
    velocity = 0;
    pipes = [];
    spawnIn = 900;
    score = 0;
    over = false;
    setScore(0);
  };

  const crash = () => {
    if (over) {
      return;
    }
    over = true;
    autoPlayRef.current = true;
    restartTimer = window.setTimeout(reset, 900);
  };

  const flap = () => {
    if (over) {
      return;
    }
    velocity = -4.2;
  };

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.flappy);
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT.flappy);
    sky.addColorStop(0, '#0b1220');
    sky.addColorStop(1, '#111c33');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT.flappy);

    for (const pipe of pipes) {
      ctx.fillStyle = '#34d399';
      ctx.strokeStyle = '#6ee7b7';
      ctx.lineWidth = 1.5;
      roundRect(ctx, pipe.x, 0, pipeWidth, pipe.gapY, 5);
      ctx.fill();
      ctx.stroke();
      roundRect(
        ctx,
        pipe.x,
        pipe.gapY + gap,
        pipeWidth,
        HEIGHT.flappy - pipe.gapY - gap,
        5,
      );
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, ground, WIDTH, HEIGHT.flappy - ground);
    ctx.fillStyle = '#334155';
    for (let x = 0; x < WIDTH; x += 18) {
      ctx.fillRect(x, ground, 8, 2);
    }

    if (logo.complete && logo.naturalWidth > 0) {
      ctx.drawImage(logo, birdX, birdY, birdSize, birdSize);
    } else {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(birdX, birdY, birdSize, birdSize);
    }

    if (over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT.flappy);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Игра окончена', WIDTH / 2, HEIGHT.flappy / 2);
    }
  };

  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    const delta = Math.min(40, now - last);
    last = now;
    const step = delta / 16.67;

    if (!over) {
      velocity += 0.32 * step;
      birdY += velocity * step;
      spawnIn -= delta;
      if (spawnIn <= 0) {
        pipes.push({
          x: WIDTH + 20,
          gapY: 32 + Math.random() * (HEIGHT.flappy - gap - 78),
          passed: false,
        });
        spawnIn = 1800;
      }

      for (const pipe of pipes) {
        pipe.x -= 1.75 * step;
        if (!pipe.passed && pipe.x + pipeWidth < birdX) {
          pipe.passed = true;
          score += 1;
          setScore(score);
        }
      }
      pipes = pipes.filter((pipe) => pipe.x + pipeWidth > -10);

      if (autoPlayRef.current && now - lastFlap > 110) {
        const next = pipes
          .filter((pipe) => pipe.x + pipeWidth > birdX)
          .sort((left, right) => left.x - right.x)[0];
        const target =
          next === undefined ? HEIGHT.flappy * 0.5 : next.gapY + gap / 2;
        const center = birdY + birdSize / 2;
        const falling = velocity > 0;
        if ((falling && center > target - 4) || birdY > HEIGHT.flappy - 64) {
          lastFlap = now;
          flap();
        }
      }

      if (birdY < 0 || birdY + birdSize > ground) {
        crash();
      }
      for (const pipe of pipes) {
        if (
          birdX + birdSize - 4 > pipe.x &&
          birdX + 4 < pipe.x + pipeWidth &&
          (birdY + 4 < pipe.gapY || birdY + birdSize - 4 > pipe.gapY + gap)
        ) {
          crash();
        }
      }
    }

    draw();
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const removeKeys = bindKeys(() => {
    autoPlayRef.current = false;
    flap();
  }, [' ', 'Spacebar', 'Space', 'ArrowUp']);

  const canvas = ctx.canvas;
  const onPointerDown = () => {
    if (over) {
      reset();
      return;
    }
    autoPlayRef.current = false;
    flap();
  };
  canvas.addEventListener('pointerdown', onPointerDown);

  return () => {
    window.cancelAnimationFrame(frame);
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
    }
    removeKeys();
    canvas.removeEventListener('pointerdown', onPointerDown);
  };
}

function setupPong({ ctx, logo, autoPlayRef, setScore, setMatch }: GameContext): () => void {
  const paddleWidth = 7;
  const paddleHeight = 52;
  const leftX = 14;
  const rightX = WIDTH - 14 - paddleWidth;
  const ballSize = 18;
  let leftY = (HEIGHT.pong - paddleHeight) / 2;
  let rightY = leftY;
  let ballX = WIDTH / 2 - ballSize / 2;
  let ballY = HEIGHT.pong / 2 - ballSize / 2;
  let ballVX = 2.6;
  let ballVY = 1.8;
  let playerScore = 0;
  let aiScore = 0;
  let matchOver = false;
  let restartTimer: number | null = null;
  let upHeld = false;
  let downHeld = false;
  setScore(0);
  setMatch?.('0 : 0');

  const resetBall = (toRight: boolean) => {
    ballX = WIDTH / 2 - ballSize / 2;
    ballY = HEIGHT.pong / 2 - ballSize / 2;
    ballVX = (toRight ? 1 : -1) * 2.6;
    ballVY = (Math.random() < 0.5 ? -1 : 1) * 1.8;
  };

  const resetMatch = () => {
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    playerScore = 0;
    aiScore = 0;
    matchOver = false;
    setScore(0);
    setMatch?.('0 : 0');
    resetBall(Math.random() < 0.5);
  };

  const finishMatch = () => {
    matchOver = true;
    restartTimer = window.setTimeout(resetMatch, 1500);
  };

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.pong);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, WIDTH, HEIGHT.pong);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 0);
    ctx.lineTo(WIDTH / 2, HEIGHT.pong);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#22d3ee';
    roundRect(ctx, leftX, leftY, paddleWidth, paddleHeight, 4);
    ctx.fill();
    ctx.fillStyle = '#f472b6';
    roundRect(ctx, rightX, rightY, paddleWidth, paddleHeight, 4);
    ctx.fill();

    if (logo.complete && logo.naturalWidth > 0) {
      ctx.drawImage(logo, ballX, ballY, ballSize, ballSize);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(ballX, ballY, ballSize, ballSize);
    }

    if (matchOver) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT.pong);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(
        playerScore > aiScore ? 'Вы победили' : 'Победил соперник',
        WIDTH / 2,
        HEIGHT.pong / 2,
      );
    }
  };

  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    const delta = Math.min(40, now - last);
    last = now;
    const step = delta / 16.67;

    if (!matchOver) {
      if (autoPlayRef.current) {
        const target =
          ballVX < 0 ? ballY + ballSize / 2 - paddleHeight / 2 : HEIGHT.pong / 2 - paddleHeight / 2;
        leftY += (target - leftY) * Math.min(1, 0.14 * step);
      } else {
        leftY += ((downHeld ? 1 : 0) - (upHeld ? 1 : 0)) * 3.6 * step;
      }
      const aiTarget = ballVX > 0 ? ballY + ballSize / 2 - paddleHeight / 2 : HEIGHT.pong / 2 - paddleHeight / 2;
      rightY += Math.max(-2.4 * step, Math.min(2.4 * step, aiTarget - rightY));
      leftY = Math.max(0, Math.min(HEIGHT.pong - paddleHeight, leftY));
      rightY = Math.max(0, Math.min(HEIGHT.pong - paddleHeight, rightY));

      ballX += ballVX * step;
      ballY += ballVY * step;

      if (ballY < 4 || ballY > HEIGHT.pong - ballSize - 4) {
        ballVY *= -1;
        ballY = Math.max(4, Math.min(HEIGHT.pong - ballSize - 4, ballY));
      }

      if (
        ballVX < 0 &&
        ballX <= leftX + paddleWidth + 4 &&
        ballX >= leftX &&
        ballY + ballSize > leftY &&
        ballY < leftY + paddleHeight
      ) {
        const hit = (ballY + ballSize / 2 - (leftY + paddleHeight / 2)) / (paddleHeight / 2);
        ballVX = Math.abs(ballVX) * 1.025;
        ballVY = hit * 3;
        ballX = leftX + paddleWidth + 4;
      }
      if (
        ballVX > 0 &&
        ballX + ballSize >= rightX - 4 &&
        ballX + ballSize <= rightX + paddleWidth &&
        ballY + ballSize > rightY &&
        ballY < rightY + paddleHeight
      ) {
        const hit = (ballY + ballSize / 2 - (rightY + paddleHeight / 2)) / (paddleHeight / 2);
        ballVX = -Math.abs(ballVX) * 1.025;
        ballVY = hit * 3;
        ballX = rightX - ballSize - 4;
      }

      if (ballX + ballSize < 0) {
        aiScore += 1;
        setMatch?.(`${playerScore} : ${aiScore}`);
        if (aiScore >= 7 || playerScore >= 7) {
          finishMatch();
        } else {
          resetBall(true);
        }
      } else if (ballX > WIDTH) {
        playerScore += 1;
        setScore(playerScore);
        setMatch?.(`${playerScore} : ${aiScore}`);
        if (playerScore >= 7 || aiScore >= 7) {
          finishMatch();
        } else {
          resetBall(false);
        }
      }
    }

    draw();
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const removeKeys = bindKeys((event) => {
    autoPlayRef.current = false;
    if (event.key === 'ArrowUp' || event.code === 'ArrowUp') {
      upHeld = true;
    } else {
      downHeld = true;
    }
  }, ['ArrowUp', 'ArrowDown']);
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.code === 'ArrowUp') {
      upHeld = false;
    } else if (event.key === 'ArrowDown' || event.code === 'ArrowDown') {
      downHeld = false;
    }
  };
  window.addEventListener('keyup', onKeyUp);

  const canvas = ctx.canvas;
  const onPointerMove = (event: PointerEvent) => {
    autoPlayRef.current = false;
    const rect = canvas.getBoundingClientRect();
    const y = (event.clientY - rect.top) * (HEIGHT.pong / rect.height);
    leftY = Math.max(0, Math.min(HEIGHT.pong - paddleHeight, y - paddleHeight / 2));
  };
  canvas.addEventListener('pointermove', onPointerMove);

  return () => {
    window.cancelAnimationFrame(frame);
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
    }
    removeKeys();
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('pointermove', onPointerMove);
  };
}

function setupTetris({ ctx, autoPlayRef, setScore }: GameContext): () => void {
  type Board = Array<Array<string | 0>>;
  interface Piece {
    shape: number[][];
    x: number;
    y: number;
    color: string;
  }

  const cols = 10;
  const rows = 20;
  const cell = 14;
  const originX = (WIDTH - cols * cell) / 2;
  const originY = 8;

  const pieceTypes = [
    { shape: [[1, 1, 1, 1]], color: '#22d3ee' },
    { shape: [[1, 1], [1, 1]], color: '#fbbf24' },
    { shape: [[0, 1, 0], [1, 1, 1]], color: '#a78bfa' },
    { shape: [[1, 0, 0], [1, 1, 1]], color: '#34d399' },
    { shape: [[0, 0, 1], [1, 1, 1]], color: '#f472b6' },
    { shape: [[1, 1, 0], [0, 1, 1]], color: '#f87171' },
    { shape: [[0, 1, 1], [1, 1, 0]], color: '#60a5fa' },
  ];

  const emptyBoard = (): Board =>
    Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => 0 as string | 0),
    );

  let board = emptyBoard();
  let piece: Piece | null = null;
  let score = 0;
  let dropIn = 0;
  let over = false;
  let restartTimer: number | null = null;
  let target: { x: number; rotation: number } | null = null;
  let fall: { from: number; to: number; start: number; duration: number } | null = null;
  let moveIn = 0;
  setScore(0);

  const rotate = (shape: number[][]) =>
    shape[0].map((_, index) => shape.map((row) => row[index]).reverse());

  const rotateTimes = (shape: number[][], times: number) => {
    let result = shape;
    for (let index = 0; index < times; index += 1) {
      result = rotate(result);
    }
    return result;
  };

  const collides = (
    candidate: Board,
    shape: number[][],
    x: number,
    y: number,
  ) => {
    for (let row = 0; row < shape.length; row += 1) {
      for (let col = 0; col < shape[row].length; col += 1) {
        if (!shape[row][col]) {
          continue;
        }
        const boardX = x + col;
        const boardY = y + row;
        if (
          boardX < 0 ||
          boardX >= cols ||
          boardY >= rows ||
          (boardY >= 0 && candidate[boardY][boardX] !== 0)
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const dropY = (candidate: Board, shape: number[][], x: number, startY: number) => {
    let y = startY;
    while (!collides(candidate, shape, x, y + 1)) {
      y += 1;
    }
    return y;
  };

  const clearLines = (candidate: Board) => {
    let cleared = 0;
    for (let row = rows - 1; row >= 0; row -= 1) {
      if (candidate[row].every((value) => value !== 0)) {
        candidate.splice(row, 1);
        candidate.unshift(Array.from({ length: cols }, () => 0 as string | 0));
        cleared += 1;
        row += 1;
      }
    }
    return cleared;
  };

  const evaluate = (candidate: Board) => {
    const heights: number[] = [];
    let holes = 0;
    for (let col = 0; col < cols; col += 1) {
      let height = 0;
      let seenBlock = false;
      for (let row = 0; row < rows; row += 1) {
        if (candidate[row][col] !== 0) {
          if (!seenBlock) {
            height = rows - row;
            seenBlock = true;
          }
        } else if (seenBlock) {
          holes += 1;
        }
      }
      heights.push(height);
    }
    const aggregate = heights.reduce((sum, value) => sum + value, 0);
    const bumpiness = heights
      .slice(1)
      .reduce((sum, value, index) => sum + Math.abs(value - heights[index]), 0);
    return -holes * 22 - aggregate * 1.2 - bumpiness * 2 - Math.max(...heights) * 0.8;
  };

  const chooseTarget = (current: Piece) => {
    let bestValue = Number.NEGATIVE_INFINITY;
    let best: { x: number; rotation: number } | null = null;
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const shape = rotateTimes(current.shape, rotation);
      for (let x = 0; x <= cols - shape[0].length; x += 1) {
        const y = dropY(board, shape, x, current.y);
        if (collides(board, shape, x, y)) {
          continue;
        }
        const candidate = board.map((row) => row.slice());
        for (let row = 0; row < shape.length; row += 1) {
          for (let col = 0; col < shape[row].length; col += 1) {
            if (shape[row][col] && y + row >= 0) {
              candidate[y + row][x + col] = current.color;
            }
          }
        }
        const lines = clearLines(candidate);
        const value = lines * 120 + evaluate(candidate);
        if (value > bestValue) {
          bestValue = value;
          best = { x, rotation };
        }
      }
    }
    return best;
  };

  const spawn = () => {
    const type = pieceTypes[Math.floor(Math.random() * pieceTypes.length)];
    const next: Piece = {
      shape: type.shape.map((row) => row.slice()),
      x: Math.floor((cols - type.shape[0].length) / 2),
      y: 0,
      color: type.color,
    };
    if (collides(board, next.shape, next.x, next.y)) {
      piece = next;
      over = true;
      restartTimer = window.setTimeout(reset, 1400);
      return;
    }
    piece = next;
    target = chooseTarget(next);
    fall = null;
    dropIn = 0;
    moveIn = 0;
  };

  const reset = () => {
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    board = emptyBoard();
    score = 0;
    over = false;
    fall = null;
    dropIn = 0;
    moveIn = 0;
    setScore(0);
    spawn();
  };

  const lock = () => {
    if (piece === null) {
      return;
    }
    const candidate = board.map((row) => row.slice());
    for (let row = 0; row < piece.shape.length; row += 1) {
      for (let col = 0; col < piece.shape[row].length; col += 1) {
        if (piece.shape[row][col] && piece.y + row >= 0) {
          candidate[piece.y + row][piece.x + col] = piece.color;
        }
      }
    }
    const lines = clearLines(candidate);
    board = candidate;
    if (lines > 0) {
      score += lines * 100;
      setScore(score);
    }
    spawn();
  };

  const startFall = () => {
    if (piece === null || fall !== null) {
      return;
    }
    const to = dropY(board, piece.shape, piece.x, piece.y);
    if (to === piece.y) {
      lock();
      return;
    }
    fall = {
      from: piece.y,
      to,
      start: performance.now(),
      duration: Math.max(140, Math.min(420, (to - piece.y) * 28)),
    };
  };

  const tryMove = (dx: number, dy: number) => {
    if (piece === null || collides(board, piece.shape, piece.x + dx, piece.y + dy)) {
      return false;
    }
    piece.x += dx;
    piece.y += dy;
    return true;
  };

  const tryRotate = () => {
    if (piece === null) {
      return;
    }
    const next = rotate(piece.shape);
    for (const shift of [0, -1, 1, -2, 2]) {
      if (!collides(board, next, piece.x + shift, piece.y)) {
        piece.shape = next;
        piece.x += shift;
        return;
      }
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.tetris);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, WIDTH, HEIGHT.tetris);
    ctx.fillStyle = '#111c33';
    roundRect(ctx, originX - 4, originY - 4, cols * cell + 8, rows * cell + 8, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let col = 1; col < cols; col += 1) {
      ctx.beginPath();
      ctx.moveTo(originX + col * cell, originY);
      ctx.lineTo(originX + col * cell, originY + rows * cell);
      ctx.stroke();
    }
    for (let row = 1; row < rows; row += 1) {
      ctx.beginPath();
      ctx.moveTo(originX, originY + row * cell);
      ctx.lineTo(originX + cols * cell, originY + row * cell);
      ctx.stroke();
    }

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const value = board[row][col];
        if (value === 0) {
          continue;
        }
        ctx.fillStyle = value;
        roundRect(ctx, originX + col * cell + 1, originY + row * cell + 1, cell - 2, cell - 2, 3);
        ctx.fill();
      }
    }

    if (piece !== null) {
      ctx.fillStyle = piece.color;
      for (let row = 0; row < piece.shape.length; row += 1) {
        for (let col = 0; col < piece.shape[row].length; col += 1) {
          if (!piece.shape[row][col]) {
            continue;
          }
          roundRect(
            ctx,
            originX + (piece.x + col) * cell + 1,
            originY + (piece.y + row) * cell + 1,
            cell - 2,
            cell - 2,
            3,
          );
          ctx.fill();
        }
      }
    }

    if (over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT.tetris);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Игра окончена', WIDTH / 2, HEIGHT.tetris / 2);
    }
  };

  spawn();

  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    const delta = Math.min(50, now - last);
    last = now;
    if (!over) {
      if (fall !== null && piece !== null) {
        const progress = Math.min(1, (now - fall.start) / fall.duration);
        const eased = progress * progress;
        piece.y = fall.from + (fall.to - fall.from) * eased;
        if (progress >= 1) {
          piece.y = fall.to;
          fall = null;
          lock();
        }
      }
      if (!over && fall === null) {
        dropIn += delta;
        moveIn += delta;
        if (autoPlayRef.current && piece !== null && target !== null && moveIn >= 120) {
          moveIn = 0;
          const shape = rotateTimes(piece.shape, 1);
          if (target.rotation > 0 && !collides(board, shape, piece.x, piece.y)) {
            piece.shape = shape;
            target.rotation -= 1;
          } else if (target.x > piece.x) {
            tryMove(1, 0);
          } else if (target.x < piece.x) {
            tryMove(-1, 0);
          }
        }
        if (dropIn >= (autoPlayRef.current ? 220 : 480)) {
          dropIn = 0;
          if (!tryMove(0, 1)) {
            lock();
          }
        }
      }
    }
    draw();
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const removeKeys = bindKeys((event) => {
    autoPlayRef.current = false;
    if (fall !== null) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      tryMove(-1, 0);
    } else if (event.key === 'ArrowRight') {
      tryMove(1, 0);
    } else if (event.key === 'ArrowDown' || event.key === ' ') {
      startFall();
    } else if (event.key === 'ArrowUp') {
      tryRotate();
    }
  }, ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Space']);

  return () => {
    window.cancelAnimationFrame(frame);
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
    }
    removeKeys();
  };
}


function setupTicTacToe({ ctx, autoPlayRef, setScore, setMatch }: GameContext): () => void {
  type Mark = '' | 'X' | 'O';
  const size = 3;
  const cell = 64;
  const boardSize = size * cell;
  const originX = (WIDTH - boardSize) / 2;
  const originY = (HEIGHT.tictactoe - boardSize) / 2;
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  let board: Mark[] = Array.from({ length: 9 }, () => '');
  let turn: 'X' | 'O' = 'X';
  let winner: Mark | 'draw' = '';
  let score = 0;
  let xWins = 0;
  let oWins = 0;
  let over = false;
  let lastMove = 0;
  let resetTimer: number | null = null;
  const placedAt = Array.from({ length: 9 }, () => 0);
  setScore(0);
  setMatch?.('0 : 0');

  const result = (): Mark | 'draw' | '' => {
    for (const [a, b, c] of lines) {
      if (board[a] !== '' && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return board.every((value) => value !== '') ? 'draw' : '';
  };

  const finish = (value: Mark | 'draw') => {
    winner = value;
    over = true;
    if (value === 'X') {
      xWins += 1;
      score = xWins;
      setScore(score);
      setMatch?.(`${xWins} : ${oWins}`);
    } else if (value === 'O') {
      oWins += 1;
      setMatch?.(`${xWins} : ${oWins}`);
    }
    resetTimer = window.setTimeout(() => {
      resetTimer = null;
      board = Array.from({ length: 9 }, () => '');
      turn = 'X';
      winner = '';
      over = false;
      lastMove = 0;
    }, 1500);
  };

  const play = (index: number) => {
    if (over || board[index] !== '') {
      return;
    }
    board[index] = turn;
    placedAt[index] = performance.now();
    const state = result();
    if (state !== '') {
      finish(state as Mark | 'draw');
      return;
    }
    turn = turn === 'X' ? 'O' : 'X';
  };

  const autoMove = () => {
    const findLine = (mark: Mark) => {
      for (const [a, b, c] of lines) {
        const cells = [a, b, c];
        if (
          cells.filter((index) => board[index] === mark).length === 2 &&
          cells.filter((index) => board[index] === '').length === 1
        ) {
          return cells.find((index) => board[index] === '')!;
        }
      }
      return null;
    };
    const win = findLine(turn);
    if (win !== null) {
      play(win);
      return;
    }
    const block = findLine(turn === 'X' ? 'O' : 'X');
    if (block !== null) {
      play(block);
      return;
    }
    const pick = [4, 0, 2, 6, 8, 1, 3, 5, 7].find((index) => board[index] === '');
    if (pick !== undefined) {
      play(pick);
    }
  };

  const draw = (now: number) => {
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, WIDTH, HEIGHT.tictactoe);
    ctx.fillStyle = '#111c33';
    roundRect(ctx, originX - 10, originY - 10, boardSize + 20, boardSize + 20, 12);
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
    ctx.lineWidth = 2;
    for (let index = 1; index < size; index += 1) {
      ctx.beginPath();
      ctx.moveTo(originX + index * cell, originY);
      ctx.lineTo(originX + index * cell, originY + boardSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(originX, originY + index * cell);
      ctx.lineTo(originX + boardSize, originY + index * cell);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 44px ui-monospace, monospace';
    board.forEach((mark, index) => {
      if (mark === '') {
        return;
      }
      const x = originX + (index % size) * cell + cell / 2;
      const y = originY + Math.floor(index / size) * cell + cell / 2;
      const progress = Math.min(1, (now - placedAt[index]) / 180);
      const scale = 0.35 + 0.65 * (1 - (1 - progress) * (1 - progress));
      ctx.save();
      ctx.globalAlpha = progress;
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = mark === 'X' ? '#22d3ee' : '#f472b6';
      ctx.fillText(mark, 0, 0);
      ctx.restore();
    });

    if (winner !== '') {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT.tictactoe);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(
        winner === 'draw' ? 'Ничья' : winner === 'X' ? 'Победили крестики' : 'Победили нолики',
        WIDTH / 2,
        HEIGHT.tictactoe / 2,
      );
    }
  };

  let frame = 0;
  const loop = (now: number) => {
    if (!over && now - lastMove > 650 && (autoPlayRef.current || turn === 'O')) {
      lastMove = now;
      autoMove();
    }
    draw(now);
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const canvas = ctx.canvas;
  const onPointerDown = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (WIDTH / rect.width);
    const y = (event.clientY - rect.top) * (HEIGHT.tictactoe / rect.height);
    const col = Math.floor((x - originX) / cell);
    const row = Math.floor((y - originY) / cell);
    if (col < 0 || col >= size || row < 0 || row >= size) {
      return;
    }
    const index = row * size + col;
    if (turn !== 'X' || board[index] !== '') {
      return;
    }
    autoPlayRef.current = false;
    play(index);
    lastMove = performance.now() - 300;
  };
  canvas.addEventListener('pointerdown', onPointerDown);

  return () => {
    window.cancelAnimationFrame(frame);
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
    }
    canvas.removeEventListener('pointerdown', onPointerDown);
  };
}

function setupWordle({ ctx, autoPlayRef, setScore }: GameContext): () => void {
  const words = [
    'apple', 'brave', 'bread', 'crane', 'dream', 'eagle', 'flame', 'grape',
    'house', 'juice', 'knife', 'lemon', 'mouse', 'night', 'ocean', 'piano',
    'queen', 'river', 'sugar', 'tiger', 'uncle', 'voice', 'water', 'young',
    'zebra', 'amber', 'blade', 'cloud', 'dance', 'earth', 'field', 'ghost',
    'honey', 'ivory', 'jolly', 'kneel', 'light', 'mango', 'north', 'opera',
    'pearl', 'quick', 'round', 'stone', 'train', 'urban', 'vivid', 'whale',
    'yacht', 'spicy',
  ];
  const cols = 5;
  const rows = 6;
  const cell = 44;
  const gap = 6;
  const boardWidth = cols * cell + (cols - 1) * gap;
  const boardHeight = rows * cell + (rows - 1) * gap;
  const originX = (WIDTH - boardWidth) / 2;
  const originY = (HEIGHT.wordle - boardHeight) / 2;
  let answer = words[Math.floor(Math.random() * words.length)];
  let candidates = words.slice();
  let guesses: Array<{ word: string; marks: string[] }> = [];
  let guessAt: number[] = [];
  let typedAt: number[] = [];
  let current = '';
  let over = false;
  let solved = false;
  let score = 0;
  let lastAuto = 0;
  let resetTimer: number | null = null;
  setScore(0);

  const evaluate = (guess: string, target: string) => {
    const marks = Array.from({ length: cols }, () => 'absent');
    const remaining: Record<string, number> = {};
    for (let index = 0; index < cols; index += 1) {
      if (guess[index] === target[index]) {
        marks[index] = 'correct';
      } else {
        remaining[target[index]] = (remaining[target[index]] ?? 0) + 1;
      }
    }
    for (let index = 0; index < cols; index += 1) {
      if (marks[index] === 'correct') {
        continue;
      }
      const letter = guess[index];
      if ((remaining[letter] ?? 0) > 0) {
        marks[index] = 'present';
        remaining[letter] -= 1;
      }
    }
    return marks;
  };

  const reset = () => {
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
    answer = words[Math.floor(Math.random() * words.length)];
    candidates = words.slice();
    guesses = [];
    guessAt = [];
    typedAt = [];
    current = '';
    over = false;
    solved = false;
    lastAuto = 0;
  };

  const submit = (word: string) => {
    if (over || word.length !== cols || guesses.length >= rows) {
      return;
    }
    const marks = evaluate(word, answer);
    guesses.push({ word, marks });
    guessAt.push(performance.now());
    typedAt = [];
    current = '';
    candidates = candidates.filter((candidate) =>
      evaluate(word, candidate).every((mark, index) => mark === marks[index]),
    );
    if (word === answer) {
      solved = true;
      score += 1;
      setScore(score);
      over = true;
      resetTimer = window.setTimeout(reset, 2000);
    } else if (guesses.length >= rows) {
      over = true;
      resetTimer = window.setTimeout(reset, 2200);
    }
  };

  const autoGuess = () => {
    const used = new Set(guesses.map((guess) => guess.word));
    // Deliberately sloppy: half the time it ignores deductions, so it misses.
    const source = Math.random() < 0.5 ? candidates : words;
    const options = source.filter((word) => !used.has(word));
    const pick =
      options[Math.floor(Math.random() * options.length)] ??
      words[Math.floor(Math.random() * words.length)];
    submit(pick);
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.wordle);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, WIDTH, HEIGHT.wordle);
    ctx.fillStyle = '#111c33';
    roundRect(
      ctx,
      originX - 10,
      originY - 10,
      boardWidth + 20,
      boardHeight + 20,
      12,
    );
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 20px ui-monospace, monospace';
    for (let row = 0; row < rows; row += 1) {
      const entry = guesses[row];
      for (let col = 0; col < cols; col += 1) {
        const x = originX + col * (cell + gap);
        const y = originY + row * (cell + gap);
        const letter =
          entry?.word[col] ??
          (row === guesses.length ? current[col] ?? '' : '');
        let background = '#1e293b';
        if (entry) {
          background =
            entry.marks[col] === 'correct'
              ? '#22c55e'
              : entry.marks[col] === 'present'
                ? '#eab308'
                : '#334155';
        }
        let scaleX = 1;
        let scaleY = 1;
        if (entry) {
          const started = (guessAt[row] ?? 0) + col * 45;
          const progress = Math.min(1, Math.max(0, (now - started) / 170));
          scaleX = 0.5 + 0.5 * (1 - (1 - progress) * (1 - progress));
          scaleY = scaleX;
        } else if (row === guesses.length && col < current.length) {
          const progress = Math.min(1, Math.max(0, (now - (typedAt[col] ?? 0)) / 220));
          scaleX = Math.max(0.04, Math.abs(Math.cos(progress * Math.PI)));
        }
        ctx.save();
        ctx.translate(x + cell / 2, y + cell / 2);
        ctx.scale(scaleX, scaleY);
        ctx.fillStyle = background;
        roundRect(ctx, -cell / 2, -cell / 2, cell, cell, 8);
        ctx.fill();
        if (letter) {
          ctx.fillStyle = entry?.marks[col] === 'present' ? '#0f172a' : '#f8fafc';
          ctx.fillText(letter.toUpperCase(), 0, 0);
        }
        ctx.restore();
      }
    }

    if (over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT.wordle);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(
        solved ? 'Угадано!' : `Слово: ${answer.toUpperCase()}`,
        WIDTH / 2,
        HEIGHT.wordle / 2,
      );
    }
  };

  let frame = 0;
  const loop = (now: number) => {
    if (!over && autoPlayRef.current && now - lastAuto > 1700) {
      lastAuto = now;
      autoGuess();
    }
    draw(now);
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      autoPlayRef.current = false;
      if (current.length === cols) {
        submit(current);
      }
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      autoPlayRef.current = false;
      current = current.slice(0, -1);
      return;
    }
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      autoPlayRef.current = false;
      if (!over && current.length < cols) {
        typedAt[current.length] = performance.now();
        current += event.key.toLowerCase();
      }
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.cancelAnimationFrame(frame);
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
    }
    window.removeEventListener('keydown', onKeyDown);
  };
}

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
  const [autoPlaying, setAutoPlaying] = useState(true);
  const [match, setMatch] = useState<string | null>(null);

  useEffect(() => {
    setBest(readBestScore(game));
    setScore(0);
    setMatch(null);
    autoPlayRef.current = true;
    setAutoPlaying(true);
  }, [game]);

  useEffect(() => {
    if (score > best) {
      setBest(score);
      saveBestScore(game as GameId, score);
    }
  }, [score, best, game]);

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
    setAutoPlaying(autoPlay);
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
    return SETUPS[game]({ ctx, logo, autoPlayRef, setScore, setMatch });
  }, [game]);

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
