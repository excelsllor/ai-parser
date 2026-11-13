export type GameId =
  | 'snake'
  | 'dino'
  | '2048'
  | 'arkanoid'
  | 'flappy'
  | 'pong'
  | 'tetris'
  | 'tictactoe'
  | 'wordle';

const STORAGE_KEYS: Record<GameId, string> = {
  snake: 'cyberbug.game.snake.best',
  dino: 'cyberbug.game.dino.best',
  '2048': 'cyberbug.game.2048.best',
  arkanoid: 'cyberbug.game.arkanoid.best',
  flappy: 'cyberbug.game.flappy.best',
  pong: 'cyberbug.game.pong.best',
  tetris: 'cyberbug.game.tetris.best',
  tictactoe: 'cyberbug.game.tictactoe.best',
  wordle: 'cyberbug.game.wordle.best',
};

export function readBestScore(game: GameId): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEYS[game]));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveBestScore(game: GameId, score: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS[game], String(score));
  } catch {
    // Private mode or disabled storage: the in-memory score still works.
  }
}
