import type { Answers, BotFn, GameDef, GameWorld } from "../../arena/types";
import { Rng } from "../../sim/rng";
import { DECIDE_EVERY_S, HIGHWAY_LEVELS, HighwayWorld, LANES, type HighwayView } from "./world";

const PLAN_ROWS = 6;

/**
 * Plans on the true road: searches lane sequences over the next rows, allowing only as many
 * moves before each row as there are decisions in time, and steers toward the path that stays
 * clear the longest (fewest moves on ties). The ceiling for this game.
 */
const autopilot: BotFn = (_req, world) => {
  const v = (world as GameWorld<HighwayView>).view();
  const rows = v.rows.filter((r) => r.s > v.s).slice(0, PLAN_ROWS);
  const decisionsBefore = (t: number) => Math.floor(Math.max(0, t - 1e-6) / DECIDE_EVERY_S) + 1;
  let best = { safe: -1, moves: Infinity, first: v.lane };

  const search = (i: number, lane: number, used: number, moves: number, first: number) => {
    if (i === rows.length) {
      if (i > best.safe || (i === best.safe && moves < best.moves)) best = { safe: i, moves, first };
      return;
    }
    const budget = decisionsBefore((rows[i]!.s - v.s) / v.speed) - used;
    for (let l = Math.max(0, lane - budget); l <= Math.min(LANES - 1, lane + budget); l++) {
      const f = i === 0 ? l : first;
      if (rows[i]!.blocked[l]) {
        if (i > best.safe || (i === best.safe && moves < best.moves)) best = { safe: i, moves, first: f };
        continue;
      }
      const step = Math.abs(l - lane);
      search(i + 1, l, used + step, moves + step, f);
    }
  };
  search(0, v.lane, 0, 0, v.lane);
  const choice = best.first < v.lane ? "left" : best.first > v.lane ? "right" : "stay";
  return { move: { type: "choice", choice } };
};

function randomBot(seed: number): BotFn {
  const rng = new Rng(seed ^ 0xca5);
  return (): Answers => ({ move: { type: "choice", choice: rng.pick(["left", "stay", "right"]) } });
}

export const highwayGame: GameDef<HighwayView> = {
  id: "highway",
  title: "Night Highway",
  levels: Object.fromEntries(Object.entries(HIGHWAY_LEVELS).map(([k, v]) => [Number(k), `${v.name} · ${v.speed} m/s`])),
  defaultLevel: 3,
  dt: 0.05,
  speeds: [0.5, 1, 2],
  defaultSpeed: 1,
  options: [
    {
      key: "state",
      label: "State text",
      default: "raw",
      values: [
        { value: "raw", label: "Raw" },
        { value: "facts", label: "Facts" },
      ],
    },
  ],
  bots: {
    autopilot: { label: "Autopilot", make: () => autopilot },
    random: { label: "Random bot", make: randomBot },
  },
  defaultControllers: ["jev", "luna", "haiku"],
  createWorld: (level, seed, options) => new HighwayWorld(level, seed, options.state === "facts"),
};
