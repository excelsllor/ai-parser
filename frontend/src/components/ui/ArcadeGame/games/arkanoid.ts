import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect, pointerX } from '../shared';

export function setupArkanoid({
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
  let leftHeld = false;
  let rightHeld = false;
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
    } else {
      paddleX += ((rightHeld ? 1 : 0) - (leftHeld ? 1 : 0)) * 4.2 * step;
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

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    autoPlayRef.current = false;
    if (event.key === 'ArrowLeft') {
      leftHeld = true;
    } else {
      rightHeld = true;
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      leftHeld = false;
    } else if (event.key === 'ArrowRight') {
      rightHeld = false;
    }
  };
  const clearKeys = () => {
    leftHeld = false;
    rightHeld = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearKeys);

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
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearKeys);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', movePaddle);
  };
}
