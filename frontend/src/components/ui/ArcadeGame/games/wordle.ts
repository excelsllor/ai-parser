import type { GameContext } from '../types';
import { WIDTH, HEIGHT, roundRect } from '../shared';

export function setupWordle({ ctx, autoPlayRef, setScore }: GameContext): () => void {
  const words = [
    'apple', 'brave', 'bread', 'crane', 'dream', 'eagle', 'flame', 'grape',
    'house', 'juice', 'knife', 'lemon', 'mouse', 'night', 'ocean', 'piano',
    'queen', 'river', 'sugar', 'tiger', 'uncle', 'voice', 'water', 'young',
    'zebra', 'amber', 'blade', 'cloud', 'dance', 'earth', 'field', 'ghost',
    'honey', 'ivory', 'jolly', 'kneel', 'light', 'mango', 'north', 'opera',
    'pearl', 'quick', 'round', 'stone', 'train', 'urban', 'vivid', 'whale',
    'yacht', 'spicy',
  ];
  const cols = 5;
  const rows = 6;
  const cell = 44;
  const gap = 6;
  const boardWidth = cols * cell + (cols - 1) * gap;
  const boardHeight = rows * cell + (rows - 1) * gap;
  const originX = (WIDTH - boardWidth) / 2;
  const originY = (HEIGHT.wordle - boardHeight) / 2;
  let answer = words[Math.floor(Math.random() * words.length)];
  let candidates = words.slice();
  let guesses: Array<{ word: string; marks: string[] }> = [];
  let guessAt: number[] = [];
  let typedAt: number[] = [];
  let current = '';
  let over = false;
  let solved = false;
  let score = 0;
  let lastAuto = 0;
  let autoWord = '';
  let autoNextAt = 0;
  let resetTimer: number | null = null;
  setScore(0);

  const evaluate = (guess: string, target: string) => {
    const marks = Array.from({ length: cols }, () => 'absent');
    const remaining: Record<string, number> = {};
    for (let index = 0; index < cols; index += 1) {
      if (guess[index] === target[index]) {
        marks[index] = 'correct';
      } else {
        remaining[target[index]] = (remaining[target[index]] ?? 0) + 1;
      }
    }
    for (let index = 0; index < cols; index += 1) {
      if (marks[index] === 'correct') {
        continue;
      }
      const letter = guess[index];
      if ((remaining[letter] ?? 0) > 0) {
        marks[index] = 'present';
        remaining[letter] -= 1;
      }
    }
    return marks;
  };

  const reset = () => {
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
    answer = words[Math.floor(Math.random() * words.length)];
    candidates = words.slice();
    guesses = [];
    guessAt = [];
    typedAt = [];
    current = '';
    over = false;
    solved = false;
    lastAuto = 0;
    autoWord = '';
    autoNextAt = 0;
  };

  const submit = (word: string) => {
    if (over || word.length !== cols || guesses.length >= rows) {
      return;
    }
    const marks = evaluate(word, answer);
    guesses.push({ word, marks });
    guessAt.push(performance.now());
    typedAt = [];
    current = '';
    candidates = candidates.filter((candidate) =>
      evaluate(word, candidate).every((mark, index) => mark === marks[index]),
    );
    if (word === answer) {
      solved = true;
      score += 1;
      setScore(score);
      over = true;
      resetTimer = window.setTimeout(reset, 2000);
    } else if (guesses.length >= rows) {
      over = true;
      resetTimer = window.setTimeout(reset, 2200);
    }
  };

  const pickAutoWord = () => {
    const used = new Set(guesses.map((guess) => guess.word));
    // Deliberately sloppy: half the time it ignores deductions, so it misses.
    const source = Math.random() < 0.5 ? candidates : words;
    const options = source.filter((word) => !used.has(word));
    return (
      options[Math.floor(Math.random() * options.length)] ??
      words[Math.floor(Math.random() * words.length)]
    );
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT.wordle);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, WIDTH, HEIGHT.wordle);
    ctx.fillStyle = '#111c33';
    roundRect(
      ctx,
      originX - 10,
      originY - 10,
      boardWidth + 20,
      boardHeight + 20,
      12,
    );
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 20px ui-monospace, monospace';
    for (let row = 0; row < rows; row += 1) {
      const entry = guesses[row];
      for (let col = 0; col < cols; col += 1) {
        const x = originX + col * (cell + gap);
        const y = originY + row * (cell + gap);
        const letter =
          entry?.word[col] ??
          (row === guesses.length ? current[col] ?? '' : '');
        const mark = entry?.marks[col];
        let background = '#1e293b';
        let flipped = false;
        let scaleX = 1;
        let scaleY = 1;
        if (entry) {
          const started = (guessAt[row] ?? 0) + col * 90;
          const progress = Math.min(1, Math.max(0, (now - started) / 330));
          flipped = progress >= 0.5;
          background = flipped
            ? mark === 'correct'
              ? '#22c55e'
              : mark === 'present'
                ? '#eab308'
                : '#334155'
            : '#1e293b';
          scaleX = Math.abs(Math.cos(progress * Math.PI));
          scaleY = scaleX;
        } else if (row === guesses.length && col < current.length) {
          const progress = Math.min(1, Math.max(0, (now - (typedAt[col] ?? 0)) / 220));
          scaleX = Math.max(0.04, Math.abs(Math.cos(progress * Math.PI)));
        }
        ctx.save();
        ctx.translate(x + cell / 2, y + cell / 2);
        ctx.scale(scaleX, scaleY);
        ctx.fillStyle = background;
        roundRect(ctx, -cell / 2, -cell / 2, cell, cell, 8);
        ctx.fill();
        if (letter) {
          ctx.fillStyle = flipped && mark === 'present' ? '#0f172a' : '#f8fafc';
          ctx.fillText(letter.toUpperCase(), 0, 0);
        }
        ctx.restore();
      }
    }

    if (over) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT.wordle);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(
        solved ? 'Угадано!' : `Слово: ${answer.toUpperCase()}`,
        WIDTH / 2,
        HEIGHT.wordle / 2,
      );
    }
  };

  let frame = 0;
  const loop = (now: number) => {
    if (!over && autoPlayRef.current) {
      if (!autoWord) {
        if (now - lastAuto > 1300) {
          autoWord = pickAutoWord();
          autoNextAt = now + 250;
        }
      } else if (current.length < autoWord.length) {
        if (now >= autoNextAt) {
          typedAt[current.length] = now;
          current += autoWord[current.length];
          autoNextAt = now + (current.length === autoWord.length ? 450 : 170);
        }
      } else if (now >= autoNextAt) {
        submit(current);
        autoWord = '';
        lastAuto = now;
      }
    }
    draw(now);
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      autoPlayRef.current = false;
      autoWord = '';
      if (current.length === cols) {
        submit(current);
      }
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      autoPlayRef.current = false;
      autoWord = '';
      current = current.slice(0, -1);
      return;
    }
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      autoPlayRef.current = false;
      autoWord = '';
      if (!over && current.length < cols) {
        typedAt[current.length] = performance.now();
        current += event.key.toLowerCase();
      }
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.cancelAnimationFrame(frame);
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
    }
    window.removeEventListener('keydown', onKeyDown);
  };
}
