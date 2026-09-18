// The decision each controller must make, defined once so Jev and the LLMs get identical
// options and wording. Jev receives these as typed "choice" questions; LLMs as a JSON schema.
import { ACTIONS, ALTITUDES, HEADINGS, SPEEDS, pad3, type Action } from "./commands";
import { compass } from "./geometry";
import type { Command } from "./types";
import type { World } from "./world";

export type Field = "action" | "heading" | "altitude" | "speed";
export const FIELDS: readonly Field[] = ["action", "heading", "altitude", "speed"];

export interface Option {
  value: string;
  description: string;
}

export interface Question {
  key: string;
  aircraft: string;
  field: Field;
  instructions: string;
  options: Option[];
}

const ACTION_TEXT: Record<Action, string> = {
  continue: "Keep the current instructions",
  vector: "Fly the chosen heading, altitude and speed",
  hold: "Circle at the present position, at the chosen altitude and speed",
  land_09L: "Clear to land on runway 09L",
  land_09R: "Clear to land on runway 09R",
};

export const FIELD_SPECS: Record<Field, { instructions: (id: string) => string; options: Option[] }> = {
  action: {
    instructions: (id) => `What should ${id} do now?`,
    options: ACTIONS.map((a) => ({ value: a, description: ACTION_TEXT[a] })),
  },
  heading: {
    instructions: (id) => `If ${id} is vectored, which heading should it fly?`,
    options: HEADINGS.map((h) => ({ value: pad3(h), description: `Heading ${pad3(h)} (${compass(h)})` })),
  },
  altitude: {
    instructions: (id) => `Which altitude should ${id} fly when vectored or holding?`,
    options: ALTITUDES.map((a) => ({ value: String(a), description: `${a} feet` })),
  },
  speed: {
    instructions: (id) => `Which speed should ${id} fly when vectored or holding?`,
    options: SPEEDS.map((s) => ({ value: String(s), description: `${s} knots` })),
  },
};

export const questionKey = (aircraft: string, field: Field) => `${aircraft}_${field}`;

/** Aircraft already on final fly themselves; everyone else needs an answer. */
export function buildQuestions(w: World): Question[] {
  const questions: Question[] = [];
  for (const a of w.airborne()) {
    if (a.phase === "final") continue;
    for (const field of FIELDS) {
      const spec = FIELD_SPECS[field];
      questions.push({ key: questionKey(a.id, field), aircraft: a.id, field, instructions: spec.instructions(a.id), options: spec.options });
    }
  }
  return questions;
}

/** Turns answers (question key -> option value) into commands. Unknown values count as invalid. */
export function answersToCommands(questions: Question[], answers: Record<string, string | undefined>): { commands: Command[]; invalid: number } {
  const byAircraft = new Map<string, Partial<Record<Field, string>>>();
  let invalid = 0;
  for (const q of questions) {
    const v = answers[q.key];
    if (v === undefined || !q.options.some((o) => o.value === v)) {
      invalid++;
      continue;
    }
    const entry = byAircraft.get(q.aircraft) ?? {};
    entry[q.field] = v;
    byAircraft.set(q.aircraft, entry);
  }

  const commands: Command[] = [];
  for (const [id, f] of byAircraft) {
    const action = f.action as Action | undefined;
    if (!action) continue;
    const cmd: Command = { id, action };
    if (action === "vector" && f.heading) cmd.heading = Number(f.heading);
    if (action === "vector" || action === "hold") {
      if (f.altitude) cmd.altitude = Number(f.altitude);
      if (f.speed) cmd.speed = Number(f.speed);
    }
    commands.push(cmd);
  }
  return { commands, invalid };
}
