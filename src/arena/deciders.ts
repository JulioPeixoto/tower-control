// Who answers the typed questions: Jev (native), an LLM (JSON schema), or a game's bot.
import { loadImage } from "../images";
import { MODELS } from "../models";
import { openrouter } from "../openrouter";
import { acquire } from "../ratelimit";
import type { Answer, Answers, DecisionRequest, DecisionResult, GameDef, GameWorld, Questions, TypedQuestion } from "./types";

export type DeciderKind = "jev" | "llm" | "bot";

export interface Decider {
  id: string;
  label: string;
  kind: DeciderKind;
  model?: string;
  decide(req: DecisionRequest, world: GameWorld): Promise<DecisionResult>;
}

export interface DeciderInfo {
  id: string;
  label: string;
  kind: DeciderKind;
  model?: string;
}

const JEV_MAX_QUESTIONS = 64;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- Jev -------------------------------------------------------------------------

interface JevResponse {
  answers?: Record<string, { type: string; choice?: string; noul?: number; score?: number; probabilities?: Record<string, number>; confidence?: number }>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

function jevDecider(id: string, label: string, model: string): Decider {
  return {
    id,
    label,
    kind: "jev",
    model,
    async decide(req): Promise<DecisionResult> {
      const t0 = performance.now();
      const keys = Object.keys(req.questions);
      const chunks: string[][] = [];
      for (let i = 0; i < keys.length; i += JEV_MAX_QUESTIONS) chunks.push(keys.slice(i, i + JEV_MAX_QUESTIONS));
      const responses = await Promise.all(
        chunks.map((ks) =>
          openrouter<JevResponse>("/alpha/decisions", {
            model,
            state: req.state,
            questions: Object.fromEntries(ks.map((k) => [k, req.questions[k]])),
          }),
        ),
      );

      const answers: Answers = {};
      let costUsd = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const r of responses) {
        for (const [k, a] of Object.entries(r.answers ?? {})) {
          if (a.type === "choice" && a.choice !== undefined) answers[k] = { type: "choice", choice: a.choice, probabilities: a.probabilities, confidence: a.confidence };
          else if (a.type === "noul" && a.noul !== undefined) answers[k] = { type: "noul", noul: a.noul };
          else if (a.type === "score" && a.score !== undefined) answers[k] = { type: "score", score: a.score, probabilities: a.probabilities, confidence: a.confidence };
        }
        costUsd += r.usage?.cost ?? 0;
        inputTokens += r.usage?.input_tokens ?? 0;
        outputTokens += r.usage?.output_tokens ?? 0;
      }
      const invalid = keys.filter((k) => !answers[k]).length;
      return { answers, invalid, latencyMs: performance.now() - t0, costUsd, inputTokens, outputTokens };
    },
  };
}

// --- LLM ---------------------------------------------------------------------------

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string };
}

const SYSTEM = "You make decisions inside a piece of software. Read the situation and answer every question. Reply only with JSON that matches the schema.";

function describeQuestion(key: string, q: TypedQuestion): string {
  switch (q.type) {
    case "choice":
      return [`- ${key} (pick one): ${q.instructions}`, ...Object.entries(q.criteria).map(([v, d]) => `    "${v}": ${d}`)].join("\n");
    case "noul":
      return [`- ${key} (probability from 0 to 1 that the answer is yes): ${q.instructions}`, `    yes: ${q.criteria.true}`, `    no: ${q.criteria.false}`].join("\n");
    case "score":
      return [`- ${key} (pick a level from 0 to ${q.criteria.length - 1}): ${q.instructions}`, ...q.criteria.map((c, i) => `    ${i}: ${c}`)].join("\n");
  }
}

function schemaFor(questions: Questions) {
  const properties: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "choice") properties[key] = { type: "string", enum: Object.keys(q.criteria) };
    else if (q.type === "noul") properties[key] = { type: "number", description: "Probability from 0 to 1 that the answer is yes" };
    else properties[key] = { type: "integer", enum: q.criteria.map((_, i) => i) };
  }
  return { type: "object", properties, required: Object.keys(questions), additionalProperties: false };
}

function toAnswer(q: TypedQuestion, raw: unknown): Answer | undefined {
  if (q.type === "choice") return typeof raw === "string" && raw in q.criteria ? { type: "choice", choice: raw } : undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (q.type === "noul") return { type: "noul", noul: clamp(n, 0, 1) };
  return { type: "score", score: clamp(Math.round(n), 0, q.criteria.length - 1) };
}

function llmDecider(id: string, label: string, model: string, reasoningEffort = "none"): Decider {
  return {
    id,
    label,
    kind: "llm",
    model,
    async decide(req): Promise<DecisionResult> {
      await acquire(model);
      const t0 = performance.now();
      const prompt = [req.state, "", "QUESTIONS (answer every one)", ...Object.entries(req.questions).map(([k, q]) => describeQuestion(k, q))].join("\n");
      // Vision models get the request's images alongside the text.
      const images = req.images?.length ? await Promise.all(req.images.map(loadImage)) : [];
      const userContent = images.length
        ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
        : prompt;
      const res = await openrouter<ChatResponse>("/v1/chat/completions", {
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_schema", json_schema: { name: "decisions", strict: true, schema: schemaFor(req.questions) } },
        reasoning: { effort: reasoningEffort },
        max_tokens: 2000,
        usage: { include: true },
      });
      const latencyMs = performance.now() - t0;
      const usage = {
        costUsd: res.usage?.cost ?? 0,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        reasoningTokens: res.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      };
      const keys = Object.keys(req.questions);
      const content = res.choices?.[0]?.message?.content;
      if (res.error || !content) return { answers: {}, invalid: keys.length, latencyMs, ...usage, error: res.error?.message ?? "empty response" };

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")) as Record<string, unknown>;
      } catch {
        return { answers: {}, invalid: keys.length, latencyMs, ...usage, error: `invalid JSON: ${content.slice(0, 120)}` };
      }
      const answers: Answers = {};
      for (const k of keys) answers[k] = toAnswer(req.questions[k]!, parsed[k]);
      return { answers, invalid: keys.filter((k) => !answers[k]).length, latencyMs, ...usage };
    },
  };
}

// --- registry ----------------------------------------------------------------------

export function deciderInfos(game: GameDef): DeciderInfo[] {
  return [
    ...MODELS.map((p) => ({ id: p.id, label: p.label, kind: p.kind as DeciderKind, model: p.model })),
    ...Object.entries(game.bots).map(([id, b]) => ({ id, label: b.label, kind: "bot" as const })),
  ];
}

/** A model preset, a bot of this game, or "jev:<model>" / "llm:<model>". */
export function makeDecider(spec: string, game: GameDef, seed: number): Decider {
  const [prefix, ...rest] = spec.split(":");
  const custom = rest.join(":");
  if (prefix === "jev" && custom) return jevDecider(spec, custom, custom);
  if (prefix === "llm" && custom) return llmDecider(spec, custom, custom);

  const bot = game.bots[spec];
  if (bot) {
    const fn = bot.make(seed);
    return {
      id: spec,
      label: bot.label,
      kind: "bot",
      async decide(req, world) {
        const t0 = performance.now();
        const answers = fn(req, world);
        return { answers, invalid: 0, latencyMs: performance.now() - t0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      },
    };
  }

  const preset = MODELS.find((p) => p.id === spec);
  if (!preset?.model) throw new Error(`Unknown controller "${spec}" for ${game.title}.`);
  return preset.kind === "jev" ? jevDecider(preset.id, preset.label, preset.model) : llmDecider(preset.id, preset.label, preset.model);
}
