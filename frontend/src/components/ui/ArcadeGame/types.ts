import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ArcadeGameId } from './arcadeGames';

export interface ArcadeGameProps {
  game: ArcadeGameId;
  message?: string;
  hint?: string;
  autoPlay?: boolean;
  onAutoPlayChange?: (active: boolean) => void;
}

export interface GameContext {
  ctx: CanvasRenderingContext2D;
  logo: HTMLImageElement;
  autoPlayRef: MutableRefObject<boolean>;
  setScore: Dispatch<SetStateAction<number>>;
  setMatch?: (value: string | null) => void;
}

export type Setup = (context: GameContext) => () => void;
