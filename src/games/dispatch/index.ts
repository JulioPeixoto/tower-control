import type { Answers, BotFn, GameDef } from "../../arena/types";
import { Rng } from "../../sim/rng";
import type { Call } from "./calls";
import { DISPATCH_LEVELS } from "./calls";
import type { Service } from "./city";
import { DispatchWorld, type DispatchView } from "./world";

const FIRE = /\b(fire|smoke|burn|burning|flames?|gas|sparking|explosion)\b/;
const MEDICAL = /\b(breath|breathing|collapsed|unconscious|blood|bleeding|hurt|pain|fell|broken|bent|pregnant|contractions|throwing up|dying|ambulance)\b/;
const POLICE = /\b(knife|gun|broke into|break-in|fight|fighting|stole|stolen|steal|smash|threat|hurt me|crime|murder|police)\b/;
const LOUD = /(!!|urgent|help|hurry|now|immediately|critical|screaming|not breathing|trapped|knife|gun)/;

/** What a regex-based triage script would do. Fooled by loud pranks, blind to calm emergencies. */
const keywordBot: BotFn = (req) => {
  const text = (req.context as Call).transcript.toLowerCase();
  const hits: [Service, number][] = [
    ["fire", (text.match(new RegExp(FIRE, "g")) ?? []).length],
    ["medical", (text.match(new RegExp(MEDICAL, "g")) ?? []).length],
    ["police", (text.match(new RegExp(POLICE, "g")) ?? []).length],
  ];
  hits.sort((a, b) => b[1] - a[1]);
  const any = hits[0]![1] > 0;
  return {
    dispatch: { type: "noul", noul: any ? 0.9 : 0.1 },
    service: { type: "choice", choice: hits[0]![0] },
    priority: { type: "score", score: LOUD.test(text) ? 2 : 1 },
  };
};

/** Knows the ground truth. Shows the best any dispatcher could do with these units. */
const oracleBot: BotFn = (req) => {
  const { truth } = req.context as Call;
  return {
    dispatch: { type: "noul", noul: truth.needs ? 1 : 0 },
    service: { type: "choice", choice: truth.service },
    priority: { type: "score", score: truth.priority },
  };
};

function randomBot(seed: number): BotFn {
  const rng = new Rng(seed ^ 0xd15);
  return (): Answers => ({
    dispatch: { type: "noul", noul: rng.next() },
    service: { type: "choice", choice: rng.pick(["fire", "medical", "police"]) },
    priority: { type: "score", score: rng.int(0, 2) },
  });
}

export const dispatchGame: GameDef<DispatchView> = {
  id: "dispatch",
  title: "City Dispatch",
  levels: Object.fromEntries(Object.entries(DISPATCH_LEVELS).map(([k, v]) => [Number(k), v.name])),
  defaultLevel: 3,
  dt: 0.5,
  speeds: [4, 8, 16, 32],
  defaultSpeed: 16,
  options: [],
  bots: {
    keyword: { label: "Keyword bot", make: () => keywordBot },
    oracle: { label: "Oracle", make: () => oracleBot },
    random: { label: "Random bot", make: randomBot },
  },
  defaultControllers: ["jev", "luna", "haiku"],
  createWorld: (level, seed) => new DispatchWorld(level, seed),
};
