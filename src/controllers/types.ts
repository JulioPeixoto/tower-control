import type { Question } from "../sim/questions";
import type { Command, WorldView } from "../sim/types";

export type ControllerKind = "jev" | "llm" | "bot";

export interface DecisionInput {
  t: number;
  stateText: string;
  questions: Question[];
  view: WorldView;
}

export interface Decision {
  commands: Command[];
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  /** Answers that were missing or not one of the allowed options. */
  invalid?: number;
  /** Jev only: confidence per question key. */
  confidence?: Record<string, number>;
  /** Jev only: full distribution for each action question. */
  actionProbs?: Record<string, Record<string, number>>;
  error?: string;
}

export interface Controller {
  id: string;
  label: string;
  kind: ControllerKind;
  model?: string;
  decide(input: DecisionInput): Promise<Decision>;
}
