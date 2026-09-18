import type { ServerWebSocket } from "bun";
import dispatchPage from "../web/dispatch/index.html";
import homePage from "../web/home/index.html";
import sortingPage from "../web/sorting/index.html";
import towerPage from "../web/tower/index.html";
import { deciderInfos, makeDecider } from "./arena/deciders";
import type { ArenaClientMessage, ArenaConfig, ArenaServerMessage } from "./arena/protocol";
import { ArenaMatch } from "./arena/runner";
import { PRESETS, makeController } from "./controllers/index";
import { GAMES } from "./games/index";
import { Match } from "./match";
import type { ClientMessage, MatchConfig, ServerMessage } from "./protocol";
import { LEVELS } from "./sim/scenario";

type Socket = ServerWebSocket<{ game: string }>;

const clients = new Map<string, Set<Socket>>();
const socketsOf = (game: string) => clients.get(game) ?? clients.set(game, new Set()).get(game)!;

function broadcast(game: string, msg: ServerMessage | ArenaServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of socketsOf(game)) ws.send(data);
}

// --- Tower Control (its own engine) ---------------------------------------------------

let towerMatch: Match | null = null;

function sanitizeTower(c: MatchConfig): MatchConfig {
  const mode = c.mode === "turn" ? "turn" : "realtime";
  return {
    level: LEVELS[c.level] ? c.level : 3,
    seed: Number.isFinite(c.seed) ? Math.max(1, Math.floor(c.seed)) : 42,
    mode,
    speed: Math.min(32, Math.max(1, Number(c.speed) || 8)),
    decisionEvery: Math.min(60, Math.max(1, Number(c.decisionEvery) || (mode === "turn" ? 10 : 2))),
    controllers: [...new Set(c.controllers)].slice(0, 6),
    facts: c.facts === true,
  };
}

async function startTower(raw: MatchConfig): Promise<void> {
  towerMatch?.stop();
  const config = sanitizeTower(raw);
  let current: Match;
  try {
    current = new Match(config, config.controllers.map((id) => makeController(id, config.seed)));
  } catch (e) {
    broadcast("tower", { type: "error", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  towerMatch = current;
  current.onFrame = (frame) => broadcast("tower", frame);
  const { stopped } = await current.run();
  const file = await current.save(stopped).catch(() => null);
  broadcast("tower", { type: "end", matchId: current.id, stopped, file, lanes: current.results() });
  if (towerMatch === current) towerMatch = null;
}

// --- Arena games -------------------------------------------------------------------------

const arenaMatches = new Map<string, ArenaMatch>();

function sanitizeArena(gameId: string, c: ArenaConfig): ArenaConfig {
  const game = GAMES[gameId]!;
  const options = Object.fromEntries(
    game.options.map((o) => [o.key, o.values.some((v) => v.value === c.options?.[o.key]) ? c.options[o.key]! : o.default]),
  );
  return {
    game: gameId,
    level: game.levels[c.level] ? c.level : game.defaultLevel,
    seed: Number.isFinite(c.seed) ? Math.max(1, Math.floor(c.seed)) : 42,
    mode: c.mode === "turn" ? "turn" : "realtime",
    speed: Math.min(64, Math.max(0.25, Number(c.speed) || game.defaultSpeed)),
    controllers: [...new Set(c.controllers)].slice(0, 6),
    options,
  };
}

async function startArena(gameId: string, raw: ArenaConfig): Promise<void> {
  const game = GAMES[gameId]!;
  arenaMatches.get(gameId)?.stop();
  const config = sanitizeArena(gameId, raw);
  let current: ArenaMatch;
  try {
    current = new ArenaMatch(
      game,
      config,
      config.controllers.map((id) => makeDecider(id, game, config.seed)),
    );
  } catch (e) {
    broadcast(gameId, { type: "error", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  arenaMatches.set(gameId, current);
  current.onFrame = (frame) => broadcast(gameId, frame);
  const { stopped } = await current.run();
  const file = await current.save(stopped).catch(() => null);
  broadcast(gameId, { type: "end", matchId: current.id, stopped, file, lanes: current.results() });
  if (arenaMatches.get(gameId) === current) arenaMatches.delete(gameId);
}

// --- HTTP + WebSocket --------------------------------------------------------------------

const server = Bun.serve<{ game: string }>({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": homePage,
    "/tower": towerPage,
    "/dispatch": dispatchPage,
    "/sorting": sortingPage,
  },
  fetch(req, srv) {
    const path = new URL(req.url).pathname;
    const game = path === "/ws" ? "tower" : path.startsWith("/ws/") ? path.slice(4) : null;
    if (game && (game === "tower" || GAMES[game]) && srv.upgrade(req, { data: { game } })) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const { game } = ws.data;
      socketsOf(game).add(ws);
      if (game === "tower") {
        const hello: ServerMessage = {
          type: "hello",
          controllers: PRESETS,
          levels: Object.entries(LEVELS).map(([level, spec]) => ({ level: Number(level), name: spec.name })),
          running: !!towerMatch?.isRunning,
        };
        ws.send(JSON.stringify(hello));
        return;
      }
      const def = GAMES[game]!;
      const hello: ArenaServerMessage = {
        type: "hello",
        running: !!arenaMatches.get(game)?.isRunning,
        game: {
          id: def.id,
          title: def.title,
          levels: Object.entries(def.levels).map(([level, name]) => ({ level: Number(level), name })),
          defaultLevel: def.defaultLevel,
          speeds: def.speeds,
          defaultSpeed: def.defaultSpeed,
          options: def.options,
          controllers: deciderInfos(def),
          defaultControllers: def.defaultControllers,
        },
      };
      ws.send(JSON.stringify(hello));
    },
    close(ws) {
      const { game } = ws.data;
      const set = socketsOf(game);
      set.delete(ws);
      // Nobody is watching this game: stop instead of spending API credits in the background.
      if (set.size) return;
      if (game === "tower") towerMatch?.stop();
      else arenaMatches.get(game)?.stop();
    },
    message(ws, raw) {
      const { game } = ws.data;
      let msg: ClientMessage | ArenaClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage | ArenaClientMessage;
      } catch {
        return;
      }
      if (game === "tower") {
        if (msg.type === "start") void startTower(msg.config as MatchConfig);
        if (msg.type === "stop") towerMatch?.stop();
        return;
      }
      if (msg.type === "start") void startArena(game, msg.config as ArenaConfig);
      if (msg.type === "stop") arenaMatches.get(game)?.stop();
    },
  },
});

if (!process.env.OPENROUTER_API_KEY) console.warn("OPENROUTER_API_KEY is not set: only the bots will work. Add it to .env");
console.log(`Decision Arena running at ${server.url}`);
