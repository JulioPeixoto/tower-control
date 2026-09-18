// Prints why aircraft were lost in one headless run.
//   bun scripts/inspect.ts <level> <seed> <controller>
import { makeController } from "../src/controllers/index";
import { Match } from "../src/match";

const [level = "3", seed = "1", ctl = "fifo"] = Bun.argv.slice(2);
const match = new Match(
  { level: Number(level), seed: Number(seed), mode: "turn", speed: 8, decisionEvery: 10, controllers: [ctl] },
  [makeController(ctl, Number(seed))],
  true,
);
const world = match.lanes[0]!.world;
const seen = new Set<string>();
const original = world.say.bind(world);
world.say = (from, text, kind, extra) => {
  if ((kind === "alert" || kind === "emergency" || kind === "notice") && !seen.has(text)) {
    seen.add(text);
    console.log(`${String(Math.round(world.t)).padStart(4)}s ${from}: ${text}`);
  }
  return original(from, text, kind, extra);
};
await match.run();
const { excessDelay, ...metrics } = world.metrics;
console.log(metrics);
