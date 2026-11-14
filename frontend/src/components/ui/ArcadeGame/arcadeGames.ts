import type { GameId } from '@utils/gameScores';

export type ArcadeGameId = GameId;

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
