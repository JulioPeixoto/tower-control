import type { Answers, BotFn, DecisionRequest, GameDef } from "../../arena/types";
import { Rng } from "../../sim/rng";
import { SORTING_LEVELS, branchOf, regionOf, truePath, type Contents, type Parcel, type ServiceLevel, type TreeNode } from "./tree";
import { SortingWorld, type SortingContext, type SortingView, type Strategy } from "./world";

// A tidy regex reader: knows the obvious words, not the synonyms.
const CONTENT_WORDS: [Contents, RegExp][] = [
  ["electronics", /laptop|smartphone|headphone|camera|console/],
  ["clothing", /jacket|t-shirt|shoe|dress|sweater/],
  ["food", /coffee|chocolate|olive oil|fruit|cheese/],
  ["documents", /contract|passport|invoice|file|deed/],
  ["glassware", /glass|vase|jar/],
  ["chemicals", /chlorine|thinner|reagent|bleach/],
  ["books", /novel|encyclopedia|textbook|comic|atlas/],
  ["toys", /game|car\b|stuffed|block|dollhouse/],
  ["medicine", /vitamin|insulin|tablet|first-aid/],
  ["auto parts", /brake|battery|spark plug|wiper|alternator/],
];

function parseLabel(label: string): { kg?: number; brl?: number; contents?: Contents; city?: string; service?: ServiceLevel; fragile: boolean } {
  const text = label.toLowerCase();
  const kg = text.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  const g = text.match(/(\d+)\s*g\b/);
  const brl = text.match(/r\$\s*([\d,]+)/);
  const contents = CONTENT_WORDS.find(([, re]) => re.test(text))?.[0];
  const city = label.match(/(?:to|in|for) ([A-ZÀ-Ý][\p{L} ]+?)(?:,|\.|$)/u)?.[1]?.trim();
  const service: ServiceLevel | undefined = /express|overnight/.test(text) ? "express" : /economy/.test(text) ? "economy" : /standard/.test(text) ? "standard" : undefined;
  return {
    kg: kg ? Number(kg[1]) : g ? Number(g[1]) / 1000 : undefined,
    brl: brl ? Number(brl[1]!.replace(/,/g, "")) : undefined,
    contents,
    city,
    service,
    fragile: /fragile/.test(text) && !/not fragile/.test(text),
  };
}

function findNode(root: TreeNode, id: string): TreeNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return undefined;
}

function parserBot(): BotFn {
  return (req: DecisionRequest): Answers => {
    const { parcel, node, root } = req.context as SortingContext;
    const read = parseLabel(parcel.label);

    // Step by step and flat: walk the tree with what the regexes read.
    if (req.questions.branch || req.questions.bay) {
      const guess: Parcel = {
        weightKg: read.kg ?? 1,
        valueBRL: read.brl ?? 100,
        contents: read.contents ?? "clothing",
        city: read.city ?? "São Paulo",
        region: read.city ? regionOf(read.city) : "Southeast",
        service: read.service ?? "standard",
        fragile: read.fragile,
      };
      if (req.questions.bay) return { bay: { type: "choice", choice: truePath(root, guess).at(-1)!.id } };
      const at = findNode(root, node)!;
      return { branch: { type: "choice", choice: "abcdefghij"[branchOf(at.split!, guess)]! } };
    }

    const answers: Answers = {};
    for (const [key, q] of Object.entries(req.questions)) {
      if (q.type === "noul") {
        answers[key] = { type: "noul", noul: read.fragile ? 0.9 : 0.1 };
        continue;
      }
      if (q.type !== "choice") continue;
      const options = Object.keys(q.criteria);
      let pick: string | undefined;
      if (key === "weight" || key === "value") {
        const v = key === "weight" ? read.kg : read.brl;
        if (v !== undefined) {
          // Option texts are "under X", "X to Y", "X or more"; the first bin whose upper bound is above v.
          const uppers = options.map((o) => Number(q.criteria[o]!.match(/(?:under|to) (?:R\$ )?([\d,.]+)/)?.[1]?.replace(/,/g, "") ?? Infinity));
          pick = options[uppers.findIndex((u) => v < u)];
        }
      } else if (key === "contents") pick = read.contents;
      else if (key === "region") pick = read.city ? regionOf(read.city) : undefined;
      else if (key === "service") pick = read.service;
      answers[key] = { type: "choice", choice: pick ?? options[0]! };
    }
    return answers;
  };
}

function randomBot(seed: number): BotFn {
  const rng = new Rng(seed ^ 0x5047);
  return (req) => {
    const answers: Answers = {};
    for (const [key, q] of Object.entries(req.questions)) {
      if (q.type === "choice") answers[key] = { type: "choice", choice: rng.pick(Object.keys(q.criteria)) };
      else if (q.type === "noul") answers[key] = { type: "noul", noul: rng.next() };
    }
    return answers;
  };
}

export const sortingGame: GameDef<SortingView> = {
  id: "sorting",
  title: "Sorting Hub",
  levels: Object.fromEntries(Object.entries(SORTING_LEVELS).map(([k, v]) => [Number(k), v.name])),
  defaultLevel: 3,
  dt: 0.25,
  speeds: [1, 2, 4, 8],
  defaultSpeed: 2,
  options: [
    {
      key: "strategy",
      label: "Strategy",
      default: "extract",
      values: [
        { value: "extract", label: "Extract" },
        { value: "stepwise", label: "Step by step" },
        { value: "flat", label: "Flat" },
      ],
    },
  ],
  bots: {
    parser: { label: "Regex parser", make: () => parserBot() },
    random: { label: "Random bot", make: randomBot },
  },
  defaultControllers: ["jev", "luna", "haiku"],
  createWorld: (level, seed, options) => new SortingWorld(level, seed, (options.strategy as Strategy) ?? "extract"),
};
