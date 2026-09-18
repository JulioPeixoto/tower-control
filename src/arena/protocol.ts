import type { LaneStats, Mode } from "../protocol";
import type { DeciderInfo, DeciderKind } from "./deciders";
import type { FeedLine, GameOption } from "./types";

export type { LaneStats, Mode };

export interface ArenaConfig {
  game: string;
  level: number;
  seed: number;
  mode: Mode;
  speed: number;
  controllers: string[];
  options: Record<string, string>;
}

export interface GameInfo {
  id: string;
  title: string;
  levels: { level: number; name: string }[];
  defaultLevel: number;
  speeds: number[];
  defaultSpeed: number;
  options: GameOption[];
  controllers: DeciderInfo[];
  defaultControllers: string[];
}

export interface ArenaLaneFrame<V = unknown> {
  id: string;
  label: string;
  kind: DeciderKind;
  model?: string;
  view: V;
  busy: boolean;
  viewAgeS: number;
  stats: LaneStats;
  score: number;
  metrics: Record<string, number>;
  feed: FeedLine[];
  done: boolean;
}

export interface ArenaFrame<V = unknown> {
  type: "frame";
  matchId: number;
  t: number;
  config: ArenaConfig;
  done: boolean;
  lanes: ArenaLaneFrame<V>[];
}

export interface ArenaLaneResult {
  id: string;
  label: string;
  score: number;
  metrics: Record<string, number>;
  stats: LaneStats;
}

export type ArenaServerMessage<V = unknown> =
  | { type: "hello"; game: GameInfo; running: boolean }
  | ArenaFrame<V>
  | { type: "end"; matchId: number; stopped: boolean; file: string | null; lanes: ArenaLaneResult[] }
  | { type: "error"; message: string };

export type ArenaClientMessage = { type: "start"; config: ArenaConfig } | { type: "stop" };
