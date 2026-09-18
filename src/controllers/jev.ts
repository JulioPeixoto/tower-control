import { openrouter } from "../openrouter";
import { answersToCommands, type Question } from "../sim/questions";
import type { Controller, Decision } from "./types";

interface JevAnswer {
  type: string;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

// 60 questions per call worked in testing; 64 keeps each aircraft's 4 questions together.
const MAX_QUESTIONS_PER_CALL = 64;

function toJevQuestions(questions: Question[]) {
  return Object.fromEntries(
    questions.map((q) => [
      q.key,
      { type: "choice", instructions: q.instructions, criteria: Object.fromEntries(q.options.map((o) => [o.value, o.description])) },
    ]),
  );
}

export function jevController(id: string, label: string, model: string): Controller {
  return {
    id,
    label,
    kind: "jev",
    model,
    async decide(input): Promise<Decision> {
      const t0 = performance.now();
      const chunks: Question[][] = [];
      for (let i = 0; i < input.questions.length; i += MAX_QUESTIONS_PER_CALL) chunks.push(input.questions.slice(i, i + MAX_QUESTIONS_PER_CALL));

      const responses = await Promise.all(
        chunks.map((qs) => openrouter<JevResponse>("/alpha/decisions", { model, state: input.stateText, questions: toJevQuestions(qs) })),
      );

      const answers: Record<string, string | undefined> = {};
      const confidence: Record<string, number> = {};
      const actionProbs: Record<string, Record<string, number>> = {};
      let costUsd = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const r of responses) {
        for (const [key, a] of Object.entries(r.answers ?? {})) {
          answers[key] = a.choice;
          if (a.confidence !== undefined) confidence[key] = a.confidence;
          if (key.endsWith("_action") && a.probabilities) actionProbs[key] = a.probabilities;
        }
        costUsd += r.usage?.cost ?? 0;
        inputTokens += r.usage?.input_tokens ?? 0;
        outputTokens += r.usage?.output_tokens ?? 0;
      }

      const { commands, invalid } = answersToCommands(input.questions, answers);
      return { commands, invalid, latencyMs: performance.now() - t0, costUsd, inputTokens, outputTokens, confidence, actionProbs };
    },
  };
}
