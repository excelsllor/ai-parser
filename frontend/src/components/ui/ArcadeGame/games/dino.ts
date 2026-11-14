import type { GameContext } from '../types';
import { WIDTH, HEIGHT } from '../shared';

export function setupDino({ ctx, logo, autoPlayRef, setScore }: GameContext): () => void {
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
