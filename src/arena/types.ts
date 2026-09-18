// Shared contract for the arena games. Every decision is a set of typed questions, the same
// shape Jev's decisions API takes natively; LLMs answer the same questions through a JSON schema.

export type TypedQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type Questions = Record<string, TypedQuestion>;

export type Answer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; probabilities?: Record<string, number>; confidence?: number };

export type Answers = Record<string, Answer | undefined>;

export interface DecisionRequest<C = unknown> {
  id: string;
  state: string;
  questions: Questions;
  /** Structured data for rule-based bots. Never shown to a model. */
  context?: C;
}

export interface DecisionResult {
  answers: Answers;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  /** Questions with a missing or out-of-range answer. */
  invalid: number;
  error?: string;
}

export type FeedKind = "info" | "decision" | "good" | "bad" | "alert" | "notice";

export interface FeedLine {
  t: number;
  kind: FeedKind;
  who?: string;
  text: string;
  /** Second line, e.g. a call transcript. */
  detail?: string;
  latencyMs?: number;
}

export interface ApplyMeta {
  latencyMs: number;
  /** Simulated seconds between asking and applying the answer. */
  staleS: number;
  deciderLabel: string;
  error?: string;
}

export interface GameWorld<V = unknown> {
  readonly t: number;
  readonly done: boolean;
  step(dt: number): void;
  /** The next decision this world needs, or null. Returns something new after `apply`. */
  request(): DecisionRequest | null;
  apply(req: DecisionRequest, answers: Answers, meta: ApplyMeta): void;
  view(): V;
  metrics(): Record<string, number>;
  score(): number;
  feed(): FeedLine[];
}

export type BotFn = (req: DecisionRequest, world: GameWorld) => Answers;

export interface GameOption {
  key: string;
  label: string;
  values: { value: string; label: string }[];
  default: string;
}

export interface GameDef<V = unknown> {
  id: string;
  title: string;
  levels: Record<number, string>;
  defaultLevel: number;
  /** Simulated seconds per physics step. */
  dt: number;
  speeds: number[];
  defaultSpeed: number;
  options: GameOption[];
  bots: Record<string, { label: string; make: (seed: number) => BotFn }>;
  defaultControllers: string[];
  createWorld(level: number, seed: number, options: Record<string, string>): GameWorld<V>;
}

// --- helpers for building worlds -----------------------------------------------

export function choiceOf(answers: Answers, key: string): string | undefined {
  const a = answers[key];
  return a?.type === "choice" ? a.choice : undefined;
}

export function noulOf(answers: Answers, key: string): number | undefined {
  const a = answers[key];
  return a?.type === "noul" ? a.noul : undefined;
}

export function scoreOf(answers: Answers, key: string): number | undefined {
  const a = answers[key];
  return a?.type === "score" ? a.score : undefined;
}
