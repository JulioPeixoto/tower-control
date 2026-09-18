import { MODELS } from "../models";
import { fifoController, randomController } from "./bots";
import { jevController } from "./jev";
import { llmController } from "./llm";
import type { Controller, ControllerKind } from "./types";

export interface ControllerInfo {
  id: string;
  label: string;
  kind: ControllerKind;
  model?: string;
}

export const PRESETS: ControllerInfo[] = [
  ...MODELS,
  { id: "fifo", label: "FIFO bot", kind: "bot" },
  { id: "random", label: "Random bot", kind: "bot" },
];

/** Accepts a preset id, or "jev:<model>" / "llm:<model>" for any OpenRouter model. */
export function makeController(spec: string, seed: number): Controller {
  const [prefix, ...rest] = spec.split(":");
  const custom = rest.join(":");
  if (prefix === "jev" && custom) return jevController(spec, custom, custom);
  if (prefix === "llm" && custom) return llmController(spec, custom, custom);

  const preset = PRESETS.find((p) => p.id === spec);
  if (!preset) throw new Error(`Unknown controller "${spec}". Use one of ${PRESETS.map((p) => p.id).join(", ")}, jev:<model> or llm:<model>.`);
  if (preset.id === "fifo") return fifoController();
  if (preset.id === "random") return randomController(seed);
  if (preset.kind === "jev") return jevController(preset.id, preset.label, preset.model!);
  return llmController(preset.id, preset.label, preset.model!);
}
