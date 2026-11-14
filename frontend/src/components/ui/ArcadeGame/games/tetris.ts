import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect, bindKeys } from '../shared';

export function setupTetris({ ctx, autoPlayRef, setScore }: GameContext): () => void {
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
