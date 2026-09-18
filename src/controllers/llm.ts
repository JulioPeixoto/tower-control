import { openrouter } from "../openrouter";
import { FIELD_SPECS, FIELDS, answersToCommands, questionKey, type Question } from "../sim/questions";
import type { Controller, Decision } from "./types";

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

const SYSTEM =
  "You are an approach air traffic controller. You receive the current radar picture and must give an instruction to every listed aircraft. Reply only with JSON that matches the schema.";

function aircraftIds(questions: Question[]): string[] {
  return [...new Set(questions.map((q) => q.aircraft))];
}

/** Same options and wording Jev gets, listed once instead of once per aircraft. */
function prompt(stateText: string, ids: string[]): string {
  const fields = FIELDS.map((f) => `- ${f}: ${FIELD_SPECS[f].options.map((o) => `"${o.value}" (${o.description})`).join(", ")}`);
  return [
    stateText,
    "",
    `DECISIONS NEEDED for: ${ids.join(", ")}`,
    "For each aircraft answer every field. heading is used only when action is vector; altitude and speed are used when action is vector or hold.",
    ...fields,
  ].join("\n");
}

function schema(ids: string[]) {
  const entry = {
    type: "object",
    properties: Object.fromEntries(FIELDS.map((f) => [f, { type: "string", enum: FIELD_SPECS[f].options.map((o) => o.value) }])),
    required: [...FIELDS],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: Object.fromEntries(ids.map((id) => [id, entry])),
    required: ids,
    additionalProperties: false,
  };
}

function parseContent(content: string): Record<string, Record<string, string>> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(cleaned) as Record<string, Record<string, string>>;
}

export function llmController(id: string, label: string, model: string, reasoningEffort = "none"): Controller {
  return {
    id,
    label,
    kind: "llm",
    model,
    async decide(input): Promise<Decision> {
      const t0 = performance.now();
      const ids = aircraftIds(input.questions);
      const res = await openrouter<ChatResponse>("/v1/chat/completions", {
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt(input.stateText, ids) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "atc_decisions", strict: true, schema: schema(ids) } },
        reasoning: { effort: reasoningEffort },
        max_tokens: 4000,
        usage: { include: true },
      });
      const latencyMs = performance.now() - t0;
      const usage = {
        costUsd: res.usage?.cost ?? 0,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        reasoningTokens: res.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      };

      const content = res.choices?.[0]?.message?.content;
      if (res.error || !content) {
        return { commands: [], latencyMs, ...usage, error: res.error?.message ?? "empty response" };
      }

      let parsed: Record<string, Record<string, string>>;
      try {
        parsed = parseContent(content);
      } catch {
        return { commands: [], latencyMs, ...usage, invalid: input.questions.length, error: `invalid JSON: ${content.slice(0, 120)}` };
      }

      const answers: Record<string, string | undefined> = {};
      for (const q of input.questions) answers[questionKey(q.aircraft, q.field)] = parsed[q.aircraft]?.[q.field];
      const { commands, invalid } = answersToCommands(input.questions, answers);
      return { commands, invalid, latencyMs, ...usage };
    },
  };
}
