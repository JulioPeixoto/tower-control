import type { ServerWebSocket } from "bun";
import index from "../web/index.html";
import { PRESETS, makeController } from "./controllers/index";
import { Match } from "./match";
import type { ClientMessage, MatchConfig, ServerMessage } from "./protocol";
import { LEVELS } from "./sim/scenario";

const clients = new Set<ServerWebSocket<unknown>>();
let match: Match | null = null;

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) ws.send(data);
}

function sanitize(c: MatchConfig): MatchConfig {
  const mode = c.mode === "turn" ? "turn" : "realtime";
  return {
    level: LEVELS[c.level] ? c.level : 3,
    seed: Number.isFinite(c.seed) ? Math.max(1, Math.floor(c.seed)) : 42,
    mode,
    speed: Math.min(32, Math.max(1, Number(c.speed) || 8)),
    decisionEvery: Math.min(60, Math.max(1, Number(c.decisionEvery) || (mode === "turn" ? 10 : 2))),
    controllers: [...new Set(c.controllers)].slice(0, 6),
  };
}

async function start(raw: MatchConfig): Promise<void> {
  match?.stop();
  const config = sanitize(raw);
  let current: Match;
  try {
    current = new Match(
      config,
      config.controllers.map((id) => makeController(id, config.seed)),
    );
  } catch (e) {
    broadcast({ type: "error", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  match = current;
  current.onFrame = (frame) => broadcast(frame);
  const { stopped } = await current.run();
  const file = await current.save(stopped).catch(() => null);
  broadcast({ type: "end", matchId: current.id, stopped, file, lanes: current.results() });
  if (match === current) match = null;
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
  },
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws" && srv.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      const hello: ServerMessage = {
        type: "hello",
        controllers: PRESETS,
        levels: Object.entries(LEVELS).map(([level, spec]) => ({ level: Number(level), name: spec.name })),
        running: !!match?.isRunning,
      };
      ws.send(JSON.stringify(hello));
    },
    close(ws) {
      clients.delete(ws);
      // Nobody is watching: stop instead of spending API credits in the background.
      if (!clients.size) match?.stop();
    },
    message(_ws, raw) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "start") void start(msg.config);
      if (msg.type === "stop") match?.stop();
    },
  },
});

if (!process.env.OPENROUTER_API_KEY) console.warn("OPENROUTER_API_KEY is not set: only the bots will work. Add it to .env");
console.log(`Tower Control running at ${server.url}`);
