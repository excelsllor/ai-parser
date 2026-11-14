import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect, bindKeys } from '../shared';

export function setup2048({ ctx, autoPlayRef, setScore }: GameContext): () => void {
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
