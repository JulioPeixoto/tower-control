// Baselines. Both read the structured view only, never the radio, so they miss runway
// closures and emergencies. That gap is what the language-reading controllers should close.
import { ACTIONS, ALTITUDES, HEADINGS, SPEEDS } from "../sim/commands";
import { ORIGIN, RUNWAYS, RUNWAY_GEOMETRY, bearing, dist, type Runway } from "../sim/geometry";
import { Rng } from "../sim/rng";
import type { AircraftView, Command } from "../sim/types";
import type { Controller, Decision } from "./types";

const HOLD_STACK = [4000, 5000, 6000, 8000, 10000];
const CLEAR_WITHIN_NM = 22;
const MIN_TRAIL_NM = 7;

const pathToThreshold = (a: AircraftView, rwy: Runway) => dist(a, RUNWAY_GEOMETRY[rwy].fix) + 8;
const nearestHeading = (deg: number) => HEADINGS.reduce((best, h) => (Math.abs(((deg - h + 540) % 360) - 180) < Math.abs(((deg - best + 540) % 360) - 180) ? h : best), 0);

/** First come, first served: clear the oldest arrival when its runway has room, stack the rest. */
export function fifoController(): Controller {
  return {
    id: "fifo",
    label: "FIFO bot",
    kind: "bot",
    async decide(input): Promise<Decision> {
      const t0 = performance.now();
      const committed: Record<Runway, number[]> = { "09L": [], "09R": [] };
      for (const a of input.view.aircraft) {
        if ((a.phase === "approach" || a.phase === "final") && a.runway) committed[a.runway].push(pathToThreshold(a, a.runway));
      }

      const commands: Command[] = [];
      let slot = 0;
      for (const a of input.view.aircraft) {
        if (a.phase !== "vectoring" && a.phase !== "holding") continue;
        const d = dist(a, ORIGIN);
        let cleared = false;
        if (d <= CLEAR_WITHIN_NM) {
          const byLoad = [...RUNWAYS].sort((x, y) => committed[x].length - committed[y].length);
          for (const rwy of byLoad) {
            const mine = pathToThreshold(a, rwy);
            const last = Math.max(-Infinity, ...committed[rwy]);
            if (mine - last >= MIN_TRAIL_NM) {
              commands.push({ id: a.id, action: rwy === "09L" ? "land_09L" : "land_09R" });
              committed[rwy].push(mine);
              cleared = true;
              break;
            }
          }
        }
        if (cleared) continue;
        const altitude = HOLD_STACK[Math.min(slot++, HOLD_STACK.length - 1)]!;
        if (d <= CLEAR_WITHIN_NM) commands.push({ id: a.id, action: "hold", altitude, speed: 220 });
        else commands.push({ id: a.id, action: "vector", heading: nearestHeading(bearing(a, ORIGIN)), altitude, speed: 250 });
      }
      return { commands, latencyMs: performance.now() - t0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    },
  };
}

/** Changes a random quarter of the aircraft each time it is asked. The floor any controller should beat. */
export function randomController(seed: number): Controller {
  const rng = new Rng(seed ^ 0x5eed);
  return {
    id: "random",
    label: "Random bot",
    kind: "bot",
    async decide(input): Promise<Decision> {
      const t0 = performance.now();
      const ids = [...new Set(input.questions.map((q) => q.aircraft))];
      const commands: Command[] = ids
        .filter(() => rng.chance(0.25))
        .map((id) => ({ id, action: rng.pick(ACTIONS), heading: rng.pick(HEADINGS), altitude: rng.pick(ALTITUDES), speed: rng.pick(SPEEDS) }));
      return { commands, latencyMs: performance.now() - t0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    },
  };
}
