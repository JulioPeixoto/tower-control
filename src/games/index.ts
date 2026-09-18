import type { GameDef } from "../arena/types";
import { dispatchGame } from "./dispatch/index";
import { sortingGame } from "./sorting/index";

export const GAMES: Record<string, GameDef<any>> = {
  [dispatchGame.id]: dispatchGame,
  [sortingGame.id]: sortingGame,
};
