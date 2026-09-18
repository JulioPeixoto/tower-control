// A seeded sorting tree. Each junction splits parcels on one attribute; each leaf is a bay.
// Pure and deterministic so the browser can rebuild the same tree from (level, seed).
import { Rng } from "../../sim/rng";

export const CONTENTS = ["electronics", "clothing", "food", "documents", "glassware", "chemicals", "books", "toys", "medicine", "auto parts"] as const;
export type Contents = (typeof CONTENTS)[number];

export const REGIONS = ["North", "Northeast", "Center-West", "Southeast", "South"] as const;
export type Region = (typeof REGIONS)[number];

export const CITIES: Record<Region, string[]> = {
  North: ["Manaus", "Belém", "Porto Velho"],
  Northeast: ["Recife", "Salvador", "Fortaleza", "Natal"],
  "Center-West": ["Brasília", "Goiânia", "Cuiabá"],
  Southeast: ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Vitória"],
  South: ["Porto Alegre", "Curitiba", "Florianópolis"],
};

export const SERVICES = ["express", "standard", "economy"] as const;
export type ServiceLevel = (typeof SERVICES)[number];

export interface Parcel {
  weightKg: number;
  valueBRL: number;
  contents: Contents;
  city: string;
  region: Region;
  service: ServiceLevel;
  fragile: boolean;
}

export type Attribute = "weight" | "value" | "contents" | "region" | "service" | "fragile";

const WEIGHT_CUTS = [0.5, 1, 2, 5, 10, 20, 30];
const VALUE_CUTS = [50, 100, 250, 500, 1000, 2500];

export type Split =
  | { attr: "weight" | "value"; cuts: number[] }
  | { attr: "contents"; groups: Contents[][] }
  | { attr: "region"; groups: Region[][] }
  | { attr: "service"; groups: ServiceLevel[][] }
  | { attr: "fragile" };

export interface TreeNode {
  id: string;
  depth: number;
  split?: Split;
  children: TreeNode[];
  /** Bay number for leaves (1-based). */
  bay?: number;
}

export interface LevelSpec {
  name: string;
  depth: number;
  branching: number;
  parcels: number;
  /** Seconds between arrivals. */
  every: number;
}

export const SORTING_LEVELS: Record<number, LevelSpec> = {
  1: { name: "Corner depot", depth: 2, branching: 3, parcels: 16, every: 9 },
  2: { name: "Regional hub", depth: 3, branching: 3, parcels: 20, every: 8 },
  3: { name: "National hub", depth: 3, branching: 5, parcels: 24, every: 7 },
  4: { name: "Mega hub (343 bays)", depth: 3, branching: 7, parcels: 24, every: 6 },
  5: { name: "Continental (625 bays)", depth: 4, branching: 5, parcels: 28, every: 6 },
};

const MAX_BRANCHES: Record<Attribute, number> = { weight: 8, value: 7, contents: 10, region: 5, service: 3, fragile: 2 };

const fmtKg = (n: number) => `${n} kg`;
const fmtBRL = (n: number) => `R$ ${n.toLocaleString("en-US")}`;

function splitGroups<T>(rng: Rng, items: readonly T[], k: number): T[][] {
  const shuffled = [...items].sort(() => rng.next() - 0.5);
  const groups: T[][] = Array.from({ length: k }, () => []);
  shuffled.forEach((item, i) => groups[i < k ? i : rng.int(0, k - 1)]!.push(item));
  return groups;
}

function makeSplit(rng: Rng, attr: Attribute, k: number): Split {
  switch (attr) {
    case "weight":
    case "value": {
      const pool = attr === "weight" ? WEIGHT_CUTS : VALUE_CUTS;
      const cuts = [...pool].sort(() => rng.next() - 0.5).slice(0, k - 1).sort((a, b) => a - b);
      return { attr, cuts };
    }
    case "contents":
      return { attr, groups: splitGroups(rng, CONTENTS, k) };
    case "region":
      return { attr, groups: splitGroups(rng, REGIONS, k) };
    case "service":
      return { attr, groups: k === 3 ? SERVICES.map((s) => [s]) : [["express"], ["standard", "economy"]] };
    case "fragile":
      return { attr };
  }
}

export function buildTree(level: number, seed: number): { root: TreeNode; bays: TreeNode[]; nodes: Map<string, TreeNode> } {
  const spec = SORTING_LEVELS[level] ?? SORTING_LEVELS[3]!;
  const rng = new Rng(seed * 4421 + level * 97);
  const bays: TreeNode[] = [];
  const nodes = new Map<string, TreeNode>();
  let junctions = 0;

  const grow = (depth: number, used: Set<Attribute>): TreeNode => {
    if (depth === spec.depth) {
      const bay = bays.length + 1;
      const leaf: TreeNode = { id: `B${String(bay).padStart(3, "0")}`, depth, children: [], bay };
      bays.push(leaf);
      nodes.set(leaf.id, leaf);
      return leaf;
    }
    const options = (Object.keys(MAX_BRANCHES) as Attribute[]).filter((a) => !used.has(a) && MAX_BRANCHES[a] >= spec.branching);
    const attr = rng.pick(options);
    const node: TreeNode = { id: `J${++junctions}`, depth, split: makeSplit(rng, attr, spec.branching), children: [] };
    nodes.set(node.id, node);
    const next = new Set(used).add(attr);
    for (let i = 0; i < spec.branching; i++) node.children.push(grow(depth + 1, next));
    return node;
  };

  return { root: grow(0, new Set()), bays, nodes };
}

/** Human description of each branch of a split, in branch order. */
export function branchLabels(split: Split): string[] {
  switch (split.attr) {
    case "weight":
    case "value": {
      const fmt = split.attr === "weight" ? fmtKg : fmtBRL;
      const noun = split.attr === "weight" ? "weight" : "declared value";
      const labels: string[] = [];
      split.cuts.forEach((c, i) => labels.push(i === 0 ? `${noun} under ${fmt(c)}` : `${noun} ${fmt(split.cuts[i - 1]!)} to ${fmt(c)}`));
      labels.push(`${noun} ${fmt(split.cuts[split.cuts.length - 1]!)} or more`);
      return labels;
    }
    case "contents":
      return split.groups.map((g) => `contents: ${g.join(", ")}`);
    case "region":
      return split.groups.map((g) => `destination region: ${g.join(", ")}`);
    case "service":
      return split.groups.map((g) => `service: ${g.join(" or ")}`);
    case "fragile":
      return ["fragile", "not fragile"];
  }
}

export function splitName(split: Split): string {
  return { weight: "weight", value: "declared value", contents: "contents", region: "destination region", service: "service level", fragile: "fragility" }[split.attr];
}

/** Which branch a parcel takes at a split (the ground truth). */
export function branchOf(split: Split, p: Parcel): number {
  switch (split.attr) {
    case "weight":
    case "value": {
      const v = split.attr === "weight" ? p.weightKg : p.valueBRL;
      const i = split.cuts.findIndex((c) => v < c);
      return i === -1 ? split.cuts.length : i;
    }
    case "contents":
      return split.groups.findIndex((g) => g.includes(p.contents));
    case "region":
      return split.groups.findIndex((g) => g.includes(p.region));
    case "service":
      return split.groups.findIndex((g) => g.includes(p.service));
    case "fragile":
      return p.fragile ? 0 : 1;
  }
}

/** Every node from the root to the parcel's true bay. */
export function truePath(root: TreeNode, p: Parcel): TreeNode[] {
  const path = [root];
  let node = root;
  while (node.split) {
    node = node.children[branchOf(node.split, p)]!;
    path.push(node);
  }
  return path;
}

/** Thresholds used anywhere in the tree for an attribute, so extraction can ask the right bins. */
export function cutsUsed(root: TreeNode, attr: "weight" | "value"): number[] {
  const cuts = new Set<number>();
  const visit = (n: TreeNode) => {
    if (n.split && n.split.attr === attr) n.split.cuts.forEach((c) => cuts.add(c));
    n.children.forEach(visit);
  };
  visit(root);
  return [...cuts].sort((a, b) => a - b);
}

export function attributesUsed(root: TreeNode): Set<Attribute> {
  const used = new Set<Attribute>();
  const visit = (n: TreeNode) => {
    if (n.split) used.add(n.split.attr);
    n.children.forEach(visit);
  };
  visit(root);
  return used;
}

/** Plain-language rule for each bay: the conditions along its path. */
export function bayRules(root: TreeNode): Map<string, string> {
  const rules = new Map<string, string>();
  const visit = (n: TreeNode, conds: string[]) => {
    if (!n.split) {
      rules.set(n.id, conds.join("; "));
      return;
    }
    const labels = branchLabels(n.split);
    n.children.forEach((c, i) => visit(c, [...conds, labels[i]!]));
  };
  visit(root, []);
  return rules;
}

export function regionOf(city: string): Region {
  return (Object.keys(CITIES) as Region[]).find((r) => CITIES[r].includes(city)) ?? "Southeast";
}
