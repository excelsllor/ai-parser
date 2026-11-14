import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect, bindKeys } from '../shared';

export function setupFlappy({ ctx, logo, autoPlayRef, setScore }: GameContext): () => void {
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
