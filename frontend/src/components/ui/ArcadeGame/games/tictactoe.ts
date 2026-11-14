import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect } from '../shared';

export function setupTicTacToe({ ctx, autoPlayRef, setScore, setMatch }: GameContext): () => void {
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
