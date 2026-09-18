// Headless runs for any arena game.
//   bun run arena --game dispatch --level 3 --seeds 1-5 --mode turn --controllers jev,luna,haiku,keyword
//   bun run arena --game sorting --option strategy=extract ...
import { parseArgs } from "node:util";
import { GAMES } from "../games/index";
import type { Mode } from "../protocol";
import { makeDecider } from "./deciders";
import { ArenaMatch } from "./runner";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    game: { type: "string", default: "dispatch" },
    level: { type: "string" },
    seeds: { type: "string", default: "1" },
    mode: { type: "string", default: "turn" },
    speed: { type: "string" },
    controllers: { type: "string" },
    option: { type: "string", multiple: true, default: [] },
    quiet: { type: "boolean", default: false },
  },
});

const game = GAMES[values.game!];
if (!game) throw new Error(`Unknown game "${values.game}". Games: ${Object.keys(GAMES).join(", ")}`);

function parseSeeds(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return b === undefined ? [a!] : Array.from({ length: b - a! + 1 }, (_, i) => a! + i);
  });
}

const mode: Mode = values.mode === "realtime" ? "realtime" : "turn";
const level = Number(values.level ?? game.defaultLevel);
const controllers = (values.controllers ?? [...game.defaultControllers, ...Object.keys(game.bots)].join(",")).split(",").filter(Boolean);
const options = Object.fromEntries(game.options.map((o) => [o.key, o.default]));
for (const kv of values.option!) {
  const [k, v] = kv.split("=");
  if (k && v) options[k] = v;
}

const rows: Record<string, string | number>[] = [];
for (const seed of parseSeeds(values.seeds!)) {
  const config = { game: game.id, level, seed, mode, speed: Number(values.speed ?? game.defaultSpeed), controllers, options };
  const match = new ArenaMatch(game, config, controllers.map((c) => makeDecider(c, game, seed)), mode === "turn");
  const started = performance.now();
  const { stopped } = await match.run();
  const file = await match.save(stopped);
  console.log(`seed ${seed}: ${((performance.now() - started) / 1000).toFixed(1)} s wall, saved ${file}`);
  for (const r of match.results()) {
    rows.push({
      seed,
      controller: r.label,
      score: r.score,
      ...(values.quiet ? {} : Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [k, Number.isInteger(v) ? v : Number(v.toFixed(3))]))),
      calls: r.stats.calls,
      errors: r.stats.errors,
      p50ms: r.stats.p50Ms ?? "-",
      costUsd: Number(r.stats.costUsd.toFixed(5)),
    });
  }
}
console.table(rows);
