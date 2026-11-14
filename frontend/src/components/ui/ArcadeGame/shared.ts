import type { ArcadeGameId } from './arcadeGames';

export const WIDTH = 320;
export const CANVAS_SCALE = 2;
export const HEIGHT: Record<ArcadeGameId, number> = {
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

export const LOGO = '/icons/logo.svg';

export function roundRect(
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

export function bindKeys(
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

export function pointerX(canvas: HTMLCanvasElement, event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return (event.clientX - rect.left) * (WIDTH / rect.width);
}
