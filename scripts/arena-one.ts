// Asks each controller for the first N decisions of an arena game. Cheap end-to-end check.
//   bun scripts/arena-one.ts <game> [level] [seed] [decisions] [controllers] [key=value options...]
import { makeDecider } from "../src/arena/deciders";
import { GAMES } from "../src/games/index";

const [gameId = "dispatch", level = "3", seed = "7", count = "3", list = "jev,luna,haiku", ...opts] = Bun.argv.slice(2);
const game = GAMES[gameId]!;
const options = Object.fromEntries(game.options.map((o) => [o.key, o.default]));
for (const kv of opts) {
  const [k, v] = kv.split("=");
  if (k && v) options[k] = v;
}
const world = game.createWorld(Number(level), Number(seed), options);
const deciders = list.split(",").map((id) => makeDecider(id, game, Number(seed)));

for (let n = 0; n < Number(count); n++) {
  let req = world.request();
  while (!req && !world.done) {
    world.step(game.dt);
    req = world.request();
  }
  if (!req) break;
  console.log(`\n=== ${req.id} at t=${world.t.toFixed(1)}s\n${req.state}\n`);
  const results = await Promise.all(deciders.map(async (d) => [d, await d.decide(req!, world).catch((e) => ({ error: String(e) }))] as const));
  for (const [d, r] of results) {
    if ("answers" in r) {
      const ans = Object.entries(r.answers)
        .map(([k, a]) => `${k}=${a?.type === "choice" ? a.choice : a?.type === "noul" ? a.noul.toFixed(2) : a?.type === "score" ? a.score.toFixed(2) : "?"}`)
        .join(" ");
      console.log(`${d.label.padEnd(18)} ${String(Math.round(r.latencyMs)).padStart(5)} ms $${r.costUsd.toFixed(6)} invalid ${r.invalid}${r.error ? ` ERROR ${r.error}` : ""}  ${ans}`);
    } else console.log(`${d.label.padEnd(18)} FAILED ${r.error}`);
  }
  // Move on with the first controller's answer so the next request is a new one.
  const first = results[0]![1];
  world.apply(req, "answers" in first ? first.answers : {}, { latencyMs: 0, staleS: 0, deciderLabel: "probe" });
}
