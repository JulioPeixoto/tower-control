// Messages between the server and the browser.
import type { ControllerInfo } from "./controllers/index";
import type { ControllerKind } from "./controllers/types";
import type { Metrics, WorldView } from "./sim/types";

export type Mode = "realtime" | "turn";

export interface MatchConfig {
  level: number;
  seed: number;
  mode: Mode;
  /** Simulated seconds per wall-clock second. */
  speed: number;
  /** Minimum simulated seconds between two decisions of the same controller. */
  decisionEvery: number;
  controllers: string[];
  /** Add code-computed facts to the state text (same questions, richer picture). */
  facts?: boolean;
}

export interface LaneStats {
  calls: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  meanStaleS: number | null;
}

export interface LaneFrame {
  id: string;
  label: string;
  kind: ControllerKind;
  model?: string;
  world: WorldView;
  busy: boolean;
  /** Simulated seconds since the picture the controller is deciding on was taken. */
  viewAgeS: number;
  ghosts: { id: string; x: number; y: number }[];
  stats: LaneStats;
  score: number;
}

export interface Frame {
  type: "frame";
  matchId: number;
  t: number;
  config: MatchConfig;
  done: boolean;
  lanes: LaneFrame[];
}

export interface LaneResult {
  id: string;
  label: string;
  score: number;
  metrics: Metrics;
  stats: LaneStats;
}

export type ServerMessage =
  | { type: "hello"; controllers: ControllerInfo[]; levels: { level: number; name: string }[]; running: boolean }
  | Frame
  | { type: "end"; matchId: number; stopped: boolean; file: string | null; lanes: LaneResult[] }
  | { type: "error"; message: string };

export type ClientMessage = { type: "start"; config: MatchConfig } | { type: "stop" };
