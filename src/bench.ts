// Headless runs for the paper.
//   bun run bench --level 3 --seeds 1-5 --mode turn --controllers jev,luna,haiku,fifo
import { parseArgs } from "node:util";
import { makeController } from "./controllers/index";
import { Match } from "./match";
import type { Mode } from "./protocol";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    level: { type: "string", default: "3" },
    seeds: { type: "string", default: "1" },
    mode: { type: "string", default: "turn" },
    speed: { type: "string", default: "8" },
    every: { type: "string" },
    controllers: { type: "string", default: "fifo,random" },
  },
});

function parseSeeds(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    if (b === undefined) return [a!];
    return Array.from({ length: b - a! + 1 }, (_, i) => a! + i);
  });
}

const mode: Mode = values.mode === "realtime" ? "realtime" : "turn";
const level = Number(values.level);
const controllers = values.controllers!.split(",").map((s) => s.trim()).filter(Boolean);
const decisionEvery = Number(values.every ?? (mode === "turn" ? 10 : 2));

const rows: Record<string, string | number>[] = [];
for (const seed of parseSeeds(values.seeds!)) {
  const config = { level, seed, mode, speed: Number(values.speed), decisionEvery, controllers };
  const match = new Match(config, controllers.map((id) => makeController(id, seed)), mode === "turn");
  const started = performance.now();
  const { stopped } = await match.run();
  const file = await match.save(stopped);
  console.log(`seed ${seed}: ${((performance.now() - started) / 1000).toFixed(1)} s wall, saved ${file}`);
  for (const r of match.results()) {
    const m = r.metrics;
    const delays = m.excessDelay;
    rows.push({
      seed,
      controller: r.label,
      score: r.score,
      landed: `${m.landed}/${m.spawned}`,
      lost: m.crashed + m.exited,
      sepLoss: m.losEvents,
      goAround: m.goArounds,
      delayS: delays.length ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length) : "-",
      calls: r.stats.calls,
      errors: r.stats.errors,
      p50ms: r.stats.p50Ms ?? "-",
      p95ms: r.stats.p95Ms ?? "-",
      costUsd: Number(r.stats.costUsd.toFixed(5)),
    });
  }
}
console.table(rows);
