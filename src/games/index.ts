import type { GameDef } from "../arena/types";
import { dispatchGame } from "./dispatch/index";
import { highwayGame } from "./highway/index";
import { sortingGame } from "./sorting/index";

export const GAMES: Record<string, GameDef<any>> = {
  [dispatchGame.id]: dispatchGame,
  [sortingGame.id]: sortingGame,
  [highwayGame.id]: highwayGame,
};
