// Parcels arrive at the intake and must reach the right bay. Three ways to decide:
//  - flat:     one choice among every bay (impossible for Jev above 255 bays)
//  - stepwise: one choice per junction, as the parcel reaches it
//  - extract:  one call extracts the parcel's attributes; code walks the tree
import type { Answers, ApplyMeta, DecisionRequest, FeedLine, GameWorld, Questions } from "../../arena/types";
import { choiceOf } from "../../arena/types";
import { generateParcels, type LabelledParcel } from "./parcels";
import {
  CITIES,
  CONTENTS,
  REGIONS,
  SERVICES,
  SORTING_LEVELS,
  attributesUsed,
  bayRules,
  branchLabels,
  branchOf,
  buildTree,
  cutsUsed,
  splitName,
  truePath,
  type Parcel,
  type TreeNode,
} from "./tree";

export type Strategy = "extract" | "stepwise" | "flat";

/** What bots get with each request (models only see the state text). */
export interface SortingContext {
  parcel: LabelledParcel;
  node: string;
  root: TreeNode;
}

const EDGE_S = 2.5;
const INTAKE_CAPACITY = 8;
const FEED_KEEP = 40;
const LETTERS = "abcdefghij";

type ParcelStatus = "queued" | "waiting" | "moving" | "delivered" | "dropped";

interface Live {
  p: LabelledParcel;
  arrivedT: number;
  status: ParcelStatus;
  /** Where it is now, or where it left from while moving. */
  node: TreeNode;
  to?: TreeNode;
  progress: number;
  /** Children to take, decided in one go (flat and extract). */
  route?: number[];
  bay?: string;
  correct?: boolean;
  doneT?: number;
}

export interface SortingView {
  strategy: Strategy;
  queue: string[];
  parcels: { id: string; from: string; to?: string; progress: number; status: ParcelStatus }[];
  deliveries: { id: string; bay: string; trueBay: string; correct: boolean; t: number }[];
  lastLabel?: { id: string; label: string };
}

function bins(cuts: number[], fmt: (n: number) => string): string[] {
  const out: string[] = [];
  cuts.forEach((c, i) => out.push(i === 0 ? `under ${fmt(c)}` : `${fmt(cuts[i - 1]!)} to ${fmt(c)}`));
  out.push(`${fmt(cuts[cuts.length - 1]!)} or more`);
  return out;
}

const regionTable = REGIONS.map((r) => `${r}: ${CITIES[r].join(", ")}`).join("; ");

export class SortingWorld implements GameWorld<SortingView> {
  t = 0;
  private readonly root: TreeNode;
  private readonly nodes: Map<string, TreeNode>;
  private readonly bayCount: number;
  private readonly parcels: LabelledParcel[];
  private readonly live: Live[] = [];
  private readonly every: number;
  private readonly timeLimit: number;
  private readonly lines: FeedLine[] = [];
  private readonly deliveries: SortingView["deliveries"] = [];
  private readonly parents = new Map<TreeNode, TreeNode>();
  private readonly extractQuestions: Questions;
  private readonly flatQuestions: Questions;
  private readonly weightCuts: number[];
  private readonly valueCuts: number[];
  private next = 0;
  private lastLabel?: SortingView["lastLabel"];
  private readonly m = {
    arrived: 0,
    delivered: 0,
    correct: 0,
    wrong: 0,
    dropped: 0,
    rejected: 0,
    timeInSystemSum: 0,
    stepDecisions: 0,
    stepCorrect: 0,
    attrAsked: 0,
    attrCorrect: 0,
  };
  private readonly perKey = new Map<string, { n: number; ok: number }>();

  constructor(
    level: number,
    seed: number,
    readonly strategy: Strategy,
  ) {
    const spec = SORTING_LEVELS[level] ?? SORTING_LEVELS[3]!;
    const tree = buildTree(level, seed);
    this.root = tree.root;
    this.nodes = tree.nodes;
    this.bayCount = tree.bays.length;
    this.parcels = generateParcels(this.root, spec.parcels, level, seed);
    this.every = spec.every;
    this.timeLimit = spec.parcels * spec.every + 900;
    const index = (n: TreeNode) => n.children.forEach((c) => (this.parents.set(c, n), index(c)));
    index(this.root);

    this.weightCuts = cutsUsed(this.root, "weight");
    this.valueCuts = cutsUsed(this.root, "value");
    const used = attributesUsed(this.root);
    const q: Questions = {};
    if (used.has("weight"))
      q.weight = { type: "choice", instructions: "How heavy is the parcel?", criteria: Object.fromEntries(bins(this.weightCuts, (n) => `${n} kg`).map((d, i) => [`w${i}`, d])) };
    if (used.has("value"))
      q.value = {
        type: "choice",
        instructions: "What is the parcel's declared value?",
        criteria: Object.fromEntries(bins(this.valueCuts, (n) => `R$ ${n.toLocaleString("en-US")}`).map((d, i) => [`v${i}`, d])),
      };
    if (used.has("contents")) q.contents = { type: "choice", instructions: "What does the parcel contain?", criteria: Object.fromEntries(CONTENTS.map((c) => [c, c])) };
    if (used.has("region")) q.region = { type: "choice", instructions: "Which region is the destination city in?", criteria: Object.fromEntries(REGIONS.map((r) => [r, `${r}: ${CITIES[r].join(", ")}`])) };
    if (used.has("service")) q.service = { type: "choice", instructions: "Which service level was booked?", criteria: Object.fromEntries(SERVICES.map((s) => [s, s])) };
    if (used.has("fragile")) q.fragile = { type: "noul", instructions: "Is the parcel fragile?", criteria: { true: "Marked fragile or to be handled with care", false: "No fragile marking" } };
    this.extractQuestions = q;

    const rules = bayRules(this.root);
    this.flatQuestions = {
      bay: { type: "choice", instructions: "Which bay does this parcel belong in? Each bay lists every condition a parcel in it meets.", criteria: Object.fromEntries(rules) },
    };
  }

  get done(): boolean {
    if (this.t >= this.timeLimit) return true;
    return this.next >= this.parcels.length && this.live.every((l) => l.status === "delivered" || l.status === "dropped");
  }

  step(dt: number): void {
    this.t += dt;
    while (this.next < this.parcels.length && this.t >= (this.next + 1) * this.every) {
      const p = this.parcels[this.next++]!;
      this.m.arrived++;
      const queued = this.live.filter((l) => l.status === "queued").length;
      if (queued >= INTAKE_CAPACITY) {
        this.m.dropped++;
        this.live.push({ p, arrivedT: this.t, status: "dropped", node: this.root, progress: 0, doneT: this.t });
        this.feedLine({ t: this.t, kind: "bad", who: p.id, text: "dropped: the intake belt is full" });
        continue;
      }
      this.live.push({ p, arrivedT: this.t, status: "queued", node: this.root, progress: 0 });
    }
    for (const l of this.live) if (l.status === "moving") this.move(l, dt);
  }

  private move(l: Live, dt: number): void {
    l.progress += dt / EDGE_S;
    if (l.progress < 1) return;
    l.node = l.to!;
    l.to = undefined;
    l.progress = 0;
    if (!l.node.split) return this.deliver(l);
    if (l.route) this.advance(l);
    else l.status = "waiting";
  }

  /** Follow a route decided up front. */
  private advance(l: Live): void {
    const depth = l.node.depth;
    const choice = l.route![depth];
    const child = choice === undefined ? undefined : l.node.children[choice];
    if (!child) return this.reject(l, "no usable answer for this junction");
    l.to = child;
    l.status = "moving";
  }

  private deliver(l: Live): void {
    const trueBay = truePath(this.root, l.p).at(-1)!.id;
    l.status = "delivered";
    l.bay = l.node.id;
    l.correct = l.bay === trueBay;
    l.doneT = this.t;
    this.m.delivered++;
    this.m.timeInSystemSum += this.t - l.arrivedT;
    if (l.correct) this.m.correct++;
    else this.m.wrong++;
    this.deliveries.push({ id: l.p.id, bay: l.bay, trueBay, correct: l.correct, t: this.t });
    if (this.deliveries.length > 30) this.deliveries.shift();
    this.feedLine({ t: this.t, kind: l.correct ? "good" : "bad", who: l.p.id, text: l.correct ? `→ ${l.bay}` : `→ ${l.bay}, belongs in ${trueBay}` });
  }

  private reject(l: Live, why: string): void {
    l.status = "dropped";
    l.doneT = this.t;
    this.m.rejected++;
    this.feedLine({ t: this.t, kind: "bad", who: l.p.id, text: `rejected: ${why}` });
  }

  // --- decisions ------------------------------------------------------------------

  request(): DecisionRequest | null {
    const waiting = this.live.filter((l) => l.status === "queued" || (l.status === "waiting" && this.strategy === "stepwise"));
    if (!waiting.length) return null;
    // Parcels deepest in the tree first, so the belt keeps flowing.
    const l = waiting.sort((a, b) => b.node.depth - a.node.depth || a.arrivedT - b.arrivedT)[0]!;
    const header = [
      "You route parcels in a sorting hub. Read the parcel label and answer about this parcel only.",
      `Regions: ${regionTable}.`,
      "",
      `Parcel ${l.p.id} label: "${l.p.label}"`,
    ];
    if (this.strategy === "stepwise") {
      const split = l.node.split!;
      const labels = branchLabels(split);
      header.push("", `The parcel is at junction ${l.node.id}, which sorts by ${splitName(split)}.`);
      return {
        id: `${l.p.id}@${l.node.id}`,
        state: header.join("\n"),
        questions: {
          branch: {
            type: "choice",
            instructions: `Which branch of junction ${l.node.id} should the parcel take?`,
            criteria: Object.fromEntries(labels.map((d, i) => [LETTERS[i]!, d])),
          },
        },
        context: { parcel: l.p, node: l.node.id, root: this.root } satisfies SortingContext,
      };
    }
    return {
      id: l.p.id,
      state: header.join("\n"),
      questions: this.strategy === "flat" ? this.flatQuestions : this.extractQuestions,
      context: { parcel: l.p, node: l.node.id, root: this.root } satisfies SortingContext,
    };
  }

  apply(req: DecisionRequest, answers: Answers, meta: ApplyMeta): void {
    const { parcel, node } = req.context as { parcel: LabelledParcel; node: string };
    const l = this.live.find((x) => x.p.id === parcel.id);
    if (!l || l.node.id !== node || (l.status !== "queued" && l.status !== "waiting")) return;
    this.lastLabel = { id: parcel.id, label: parcel.label };
    if (meta.error) this.feedLine({ t: this.t, kind: "alert", who: "SYS", text: `No usable answer from ${meta.deciderLabel}: ${meta.error.slice(0, 140)}` });

    if (this.strategy === "stepwise") {
      const choice = choiceOf(answers, "branch");
      const idx = choice === undefined ? -1 : LETTERS.indexOf(choice);
      const truth = branchOf(l.node.split!, parcel);
      this.m.stepDecisions++;
      this.tally(`depth${l.node.depth + 1}`, idx === truth);
      if (idx === truth) this.m.stepCorrect++;
      const child = l.node.children[idx];
      if (!child) return this.reject(l, "no usable answer");
      this.feedLine({ t: this.t, kind: "decision", who: parcel.id, text: `${l.node.id} → ${branchLabels(l.node.split!)[idx]}`, latencyMs: meta.latencyMs || undefined });
      l.to = child;
      l.status = "moving";
      return;
    }

    if (this.strategy === "flat") {
      const bay = choiceOf(answers, "bay");
      const target = bay ? this.nodes.get(bay) : undefined;
      if (!target) return this.reject(l, "no usable answer");
      const route: number[] = [];
      for (let n = target; this.parents.has(n); n = this.parents.get(n)!) route.unshift(this.parents.get(n)!.children.indexOf(n));
      l.route = route;
      this.feedLine({ t: this.t, kind: "decision", who: parcel.id, text: `bay ${bay}`, latencyMs: meta.latencyMs || undefined });
      this.advance(l);
      return;
    }

    // extract: turn the answers into a parcel, then let code walk the tree.
    const read = this.readParcel(answers, parcel);
    l.route = [];
    for (let n: TreeNode = this.root; n.split; ) {
      const i = read ? branchOf(n.split, read) : -1;
      if (i < 0) break;
      l.route.push(i);
      n = n.children[i]!;
    }
    const got = Object.entries(answers)
      .map(([k, a]) => `${k} ${a?.type === "choice" ? a.choice : a?.type === "noul" ? a.noul.toFixed(2) : "?"}`)
      .join(", ");
    this.feedLine({ t: this.t, kind: "decision", who: parcel.id, text: got || "no answer", latencyMs: meta.latencyMs || undefined });
    this.advance(l);
  }

  /** Map extracted bins back to representative values, and score each attribute. */
  private readParcel(answers: Answers, truth: Parcel): Parcel | null {
    const pickBin = (cuts: number[], key: string, prefix: string, actual: number): number | null => {
      const c = choiceOf(answers, key);
      if (c === undefined) return null;
      const i = Number(c.slice(prefix.length));
      const trueBin = cuts.findIndex((x) => actual < x);
      this.tally(key, i === (trueBin === -1 ? cuts.length : trueBin));
      // Middle of the bin (or just past the ends).
      if (i <= 0) return cuts[0]! / 2;
      if (i >= cuts.length) return cuts[cuts.length - 1]! * 1.5;
      return (cuts[i - 1]! + cuts[i]!) / 2;
    };
    const q = this.extractQuestions;
    const read: Parcel = { ...truth };
    if (q.weight) {
      const v = pickBin(this.weightCuts, "weight", "w", truth.weightKg);
      if (v === null) return null;
      read.weightKg = v;
    }
    if (q.value) {
      const v = pickBin(this.valueCuts, "value", "v", truth.valueBRL);
      if (v === null) return null;
      read.valueBRL = v;
    }
    for (const key of ["contents", "region", "service"] as const) {
      if (!q[key]) continue;
      const c = choiceOf(answers, key);
      if (c === undefined) return null;
      this.tally(key, c === truth[key]);
      (read as unknown as Record<string, string>)[key] = c;
    }
    if (q.fragile) {
      const a = answers.fragile;
      if (a?.type !== "noul") return null;
      read.fragile = a.noul >= 0.5;
      this.tally("fragile", read.fragile === truth.fragile);
    }
    return read;
  }

  private tally(key: string, ok: boolean): void {
    const e = this.perKey.get(key) ?? { n: 0, ok: 0 };
    e.n++;
    if (ok) e.ok++;
    this.perKey.set(key, e);
    this.m.attrAsked++;
    if (ok) this.m.attrCorrect++;
  }

  private feedLine(line: FeedLine): void {
    this.lines.push(line);
    if (this.lines.length > FEED_KEEP) this.lines.shift();
  }

  // --- reporting ------------------------------------------------------------------

  metrics(): Record<string, number> {
    const m = this.m;
    const out: Record<string, number> = {
      ...m,
      bays: this.bayCount,
      accuracy: m.delivered ? m.correct / m.delivered : 0,
      perMinute: this.t > 0 ? (m.delivered / this.t) * 60 : 0,
      avgTimeInSystem: m.delivered ? m.timeInSystemSum / m.delivered : 0,
    };
    for (const [k, v] of this.perKey) out[`acc_${k}`] = v.n ? v.ok / v.n : 0;
    return out;
  }

  score(): number {
    const m = this.m;
    return m.correct * 10 - m.wrong * 15 - m.dropped * 10 - m.rejected * 10;
  }

  feed(): FeedLine[] {
    return this.lines.slice(-24);
  }

  view(): SortingView {
    return {
      strategy: this.strategy,
      queue: this.live.filter((l) => l.status === "queued").map((l) => l.p.id),
      parcels: this.live
        .filter((l) => l.status === "moving" || l.status === "waiting")
        .map((l) => ({ id: l.p.id, from: l.node.id, to: l.to?.id, progress: l.progress, status: l.status })),
      deliveries: this.deliveries.slice(-20),
      lastLabel: this.lastLabel,
    };
  }
}
