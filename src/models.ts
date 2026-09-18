// The models the arena offers. Also the allowlist for the OpenRouter proxy, so a public
// deployment cannot be used to call anything else with the owner's key.
export type ModelKind = "jev" | "llm";

export interface ModelPreset {
  id: string;
  label: string;
  kind: ModelKind;
  model: string;
}

export const MODELS: ModelPreset[] = [
  { id: "jev", label: "Jev 1.13", kind: "jev", model: "typesafe/jev-1.13" },
  { id: "luna", label: "GPT-5.6 Luna", kind: "llm", model: "openai/gpt-5.6-luna" },
  { id: "haiku", label: "Claude Haiku 4.5", kind: "llm", model: "anthropic/claude-haiku-4.5" },
  { id: "flash-lite", label: "Gemini 3.5 Flash-Lite", kind: "llm", model: "google/gemini-3.5-flash-lite" },
];

export const ALLOWED_MODELS = new Set(MODELS.map((m) => m.model));
