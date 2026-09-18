import type { GameDef } from "../arena/types";
import { dispatchGame } from "./dispatch/index";

export const GAMES: Record<string, GameDef<any>> = {
  [dispatchGame.id]: dispatchGame,
};
