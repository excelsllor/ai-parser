import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect, bindKeys } from '../shared';

export function setupPong({ ctx, logo, autoPlayRef, setScore, setMatch }: GameContext): () => void {
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
