import type { Answers, BotFn, DecisionRequest, GameDef } from "../../arena/types";
import { PATROL_LEVELS, type Scene } from "./scenes";
import { PatrolWorld, type Appearance, type PatrolView } from "./world";

type Ctx = { stage: "call" | "scene"; scene: Scene };

/** Follows each scene's ground truth: what the situation calls for, blind to who the person is. */
function protocol(req: DecisionRequest): Answers {
  const { stage, scene } = req.context as Ctx;
  const t = scene.truth;
  if (stage === "call") return { dispatch: { type: "noul", noul: t.needsUnit ? 0.95 : 0.05 }, priority: { type: "score", score: t.priority } };
  return {
    threat: { type: "score", score: t.threat },
    armed: { type: "noul", noul: t.armed ? 0.95 : 0.05 },
    approach: { type: "choice", choice: t.approachOk[0]! },
    search: { type: "noul", noul: t.searchJustified ? 0.9 : 0.05 },
  };
}

/**
 * A deliberately biased control: the protocol bot, plus more suspicion toward Black people.
 * It exists to show that the bias panel detects bias when there is some. Never a baseline.
 */
function biasedControl(req: DecisionRequest): Answers {
  const a = protocol(req);
  const { stage, scene } = req.context as Ctx;
  if (scene.variant !== "black") return a;
  if (stage === "call" && a.dispatch?.type === "noul") a.dispatch = { type: "noul", noul: Math.min(1, a.dispatch.noul + 0.5) };
  if (stage === "scene") {
    if (a.armed?.type === "noul") a.armed = { type: "noul", noul: Math.min(1, a.armed.noul + 0.35) };
    if (a.threat?.type === "score") a.threat = { type: "score", score: Math.min(3, a.threat.score + 1) };
    if (!scene.truth.armed) a.approach = { type: "choice", choice: "detain" };
    a.search = { type: "noul", noul: 0.8 };
  }
  return a;
}

const WEAPON = /\b(gun|handgun|knife|crowbar)\b/i;
const CRIME = /\b(robbed|grabbed|took|spray-painting|waving|weapon|shouting|break)\b/i;

/** Reads words, not people: sends cars on crime words, sees weapons on weapon words. */
function keywordBot(req: DecisionRequest): Answers {
  const { stage } = req.context as Ctx;
  const text = req.state;
  if (stage === "call") {
    const crime = CRIME.test(text);
    return { dispatch: { type: "noul", noul: crime ? 0.9 : 0.4 }, priority: { type: "score", score: WEAPON.test(text) ? 2 : crime ? 1 : 0 } };
  }
  const armed = WEAPON.test(text.split("They find")[1] ?? "");
  return {
    threat: { type: "score", score: armed ? 3 : 1 },
    armed: { type: "noul", noul: armed ? 0.9 : 0.1 },
    approach: { type: "choice", choice: armed ? "backup" : "talk" },
    search: { type: "noul", noul: armed ? 0.9 : 0.2 },
  };
}

export const patrolGame: GameDef<PatrolView> = {
  id: "patrol",
  title: "Street Patrol",
  levels: Object.fromEntries(Object.entries(PATROL_LEVELS).map(([k, v]) => [Number(k), `${v.name} · ${v.scenes} scenes × 3`])),
  defaultLevel: 2,
  dt: 0.5,
  speeds: [4, 8, 16, 32],
  defaultSpeed: 16,
  options: [
    {
      key: "appearance",
      label: "Person shown as",
      default: "text",
      values: [
        { value: "text", label: "Text" },
        { value: "photo", label: "Photo" },
      ],
    },
  ],
  bots: {
    protocol: { label: "Protocol bot", make: () => protocol },
    biased: { label: "Biased control", make: () => biasedControl },
    keyword: { label: "Keyword bot", make: () => keywordBot },
  },
  defaultControllers: ["jev", "luna", "haiku"],
  createWorld: (level, seed, options) => new PatrolWorld(level, seed, (options.appearance as Appearance) ?? "text"),
};
