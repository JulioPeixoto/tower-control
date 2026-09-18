// Runs matches wherever this module is loaded (the browser, in a deployment) and speaks the
// same messages the pages already understand: hello, frame, end, error. A page calls
// `send({ type: "start" | "stop" })` and receives messages through `emit`.
import { deciderInfos, makeDecider } from "./arena/deciders";
import type { ArenaClientMessage, ArenaConfig, ArenaServerMessage, GameInfo } from "./arena/protocol";
import { ArenaMatch } from "./arena/runner";
import type { GameDef } from "./arena/types";
import { PRESETS, makeController } from "./controllers/index";
import { GAMES } from "./games/index";
import { Match } from "./match";
import type { ClientMessage, MatchConfig, ServerMessage } from "./protocol";
import { LEVELS } from "./sim/scenario";

export interface Engine<In> {
  send(msg: In): void;
}

// --- Tower Control ---------------------------------------------------------------------

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

export function towerEngine(emit: (msg: ServerMessage) => void): Engine<ClientMessage> {
  let match: Match | null = null;
  queueMicrotask(() =>
    emit({
      type: "hello",
      controllers: PRESETS,
      levels: Object.entries(LEVELS).map(([level, spec]) => ({ level: Number(level), name: spec.name })),
      running: false,
    }),
  );

  async function start(raw: MatchConfig): Promise<void> {
    match?.stop();
    const config = sanitizeTower(raw);
    let current: Match;
    try {
      current = new Match(config, config.controllers.map((id) => makeController(id, config.seed)));
    } catch (e) {
      emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    match = current;
    current.onFrame = emit;
    const { stopped } = await current.run();
    emit({ type: "end", matchId: current.id, stopped, file: null, lanes: current.results(), record: current.record(stopped) });
    if (match === current) match = null;
  }

  return {
    send(msg) {
      if (msg.type === "start") void start(msg.config);
      if (msg.type === "stop") match?.stop();
    },
  };
}

// --- Arena games -------------------------------------------------------------------------

export function gameInfo(def: GameDef): GameInfo {
  return {
    id: def.id,
    title: def.title,
    levels: Object.entries(def.levels).map(([level, name]) => ({ level: Number(level), name })),
    defaultLevel: def.defaultLevel,
    speeds: def.speeds,
    defaultSpeed: def.defaultSpeed,
    options: def.options,
    controllers: deciderInfos(def),
    defaultControllers: def.defaultControllers,
  };
}

function sanitizeArena(game: GameDef, c: ArenaConfig): ArenaConfig {
  const options = Object.fromEntries(
    game.options.map((o) => [o.key, o.values.some((v) => v.value === c.options?.[o.key]) ? c.options[o.key]! : o.default]),
  );
  return {
    game: game.id,
    level: game.levels[c.level] ? c.level : game.defaultLevel,
    seed: Number.isFinite(c.seed) ? Math.max(1, Math.floor(c.seed)) : 42,
    mode: c.mode === "turn" ? "turn" : "realtime",
    speed: Math.min(64, Math.max(0.25, Number(c.speed) || game.defaultSpeed)),
    controllers: [...new Set(c.controllers)].slice(0, 6),
    options,
  };
}

export function arenaEngine(gameId: string, emit: (msg: ArenaServerMessage) => void): Engine<ArenaClientMessage> {
  const game = GAMES[gameId];
  let match: ArenaMatch | null = null;
  queueMicrotask(() => (game ? emit({ type: "hello", game: gameInfo(game), running: false }) : emit({ type: "error", message: `Unknown game "${gameId}".` })));

  async function start(raw: ArenaConfig): Promise<void> {
    if (!game) return;
    match?.stop();
    const config = sanitizeArena(game, raw);
    let current: ArenaMatch;
    try {
      current = new ArenaMatch(game, config, config.controllers.map((id) => makeDecider(id, game, config.seed)));
    } catch (e) {
      emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    match = current;
    current.onFrame = emit;
    const { stopped } = await current.run();
    emit({ type: "end", matchId: current.id, stopped, file: null, lanes: current.results(), record: current.record(stopped) });
    if (match === current) match = null;
  }

  return {
    send(msg) {
      if (msg.type === "start") void start(msg.config);
      if (msg.type === "stop") match?.stop();
    },
  };
}
