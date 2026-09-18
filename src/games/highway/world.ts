// Five lanes at night. Barrier rows come up the road; each answer moves the car at most one
// lane. In real time the road keeps moving while the model thinks, so latency is distance.
import type { Answers, ApplyMeta, DecisionRequest, FeedLine, GameWorld, Questions } from "../../arena/types";
import { choiceOf } from "../../arena/types";
import { Rng } from "../../sim/rng";

export const LANES = 5;
export const DECIDE_EVERY_S = 0.5;
const VIEW_AHEAD_M = 130;
const FEED_KEEP = 40;

export interface HighwayLevel {
  name: string;
  speed: number;
  gap: [number, number];
  block: [number, number];
  length: number;
}

export const HIGHWAY_LEVELS: Record<number, HighwayLevel> = {
  1: { name: "Empty road", speed: 16, gap: [55, 75], block: [1, 2], length: 1200 },
  2: { name: "Late commute", speed: 20, gap: [45, 65], block: [1, 2], length: 1500 },
  3: { name: "Night shift", speed: 24, gap: [40, 55], block: [2, 3], length: 1800 },
  4: { name: "Rain", speed: 28, gap: [35, 50], block: [2, 3], length: 2100 },
  5: { name: "Rally", speed: 32, gap: [30, 45], block: [3, 4], length: 2400 },
};

interface Row {
  s: number;
  blocked: boolean[];
  hit?: number;
}

interface Coin {
  s: number;
  lane: number;
  taken?: boolean;
}

export interface HighwayView {
  s: number;
  lane: number;
  prevLane: number;
  laneChangedAt: number;
  t: number;
  speed: number;
  length: number;
  rows: { s: number; blocked: boolean[]; hit?: number }[];
  coins: { s: number; lane: number; taken?: boolean }[];
  crashes: number[];
}

export const QUESTIONS: Questions = {
  move: {
    type: "choice",
    instructions: "Which way should the car go now?",
    criteria: { left: "Move one lane to the left", stay: "Stay in this lane", right: "Move one lane to the right" },
  },
};

function generate(level: HighwayLevel, seed: number): { rows: Row[]; coins: Coin[] } {
  const rng = new Rng(seed * 3301 + level.speed);
  const rows: Row[] = [];
  const coins: Coin[] = [];
  let s = 60;
  let prevFree = [0, 1, 2, 3, 4];
  while (s < level.length - 40) {
    // Pick blocked lanes so at least one free lane is within one move of the last free lanes.
    let blocked: boolean[] = [];
    for (let tries = 0; tries < 40; tries++) {
      const k = rng.int(level.block[0], level.block[1]);
      const lanes = [0, 1, 2, 3, 4].sort(() => rng.next() - 0.5).slice(0, k);
      blocked = [0, 1, 2, 3, 4].map((l) => lanes.includes(l));
      const free = [0, 1, 2, 3, 4].filter((l) => !blocked[l]);
      if (free.some((f) => prevFree.some((p) => Math.abs(p - f) <= 1))) break;
    }
    rows.push({ s, blocked });
    const free = [0, 1, 2, 3, 4].filter((l) => !blocked[l]);
    prevFree = free;
    const gap = rng.range(level.gap[0], level.gap[1]);
    if (rng.chance(0.6)) coins.push({ s: s + gap / 2, lane: rng.pick(free) });
    s += gap;
  }
  return { rows, coins };
}

export class HighwayWorld implements GameWorld<HighwayView> {
  t = 0;
  private s = 0;
  private lane = 2;
  private prevLane = 2;
  private laneChangedAt = -10;
  private nextDecisionT = 0;
  private readonly level: HighwayLevel;
  private readonly rows: Row[];
  private readonly coins: Coin[];
  private readonly lines: FeedLine[] = [];
  private readonly crashTimes: number[] = [];
  private seq = 0;
  private readonly m = { crashes: 0, coins: 0, coinsTotal: 0, moves: 0, decisions: 0, staleSum: 0 };

  constructor(
    level: number,
    seed: number,
    private readonly facts: boolean,
  ) {
    this.level = HIGHWAY_LEVELS[level] ?? HIGHWAY_LEVELS[3]!;
    const g = generate(this.level, seed);
    this.rows = g.rows;
    this.coins = g.coins;
    this.m.coinsTotal = g.coins.length;
  }

  get done(): boolean {
    return this.s >= this.level.length;
  }

  step(dt: number): void {
    this.t += dt;
    const from = this.s;
    this.s = Math.min(this.level.length, this.s + this.level.speed * dt);
    for (const r of this.rows) {
      if (r.s > from && r.s <= this.s && r.blocked[this.lane]) {
        r.hit = this.lane;
        this.m.crashes++;
        this.crashTimes.push(this.t);
        this.feedLine({ t: this.t, kind: "bad", text: `hit a barrier in lane ${this.lane + 1}` });
      }
    }
    for (const c of this.coins) {
      if (!c.taken && c.s > from && c.s <= this.s && c.lane === this.lane) {
        c.taken = true;
        this.m.coins++;
      }
    }
  }

  // --- decisions ----------------------------------------------------------------

  private ahead(): Row[] {
    return this.rows.filter((r) => r.s > this.s && r.s - this.s <= VIEW_AHEAD_M);
  }

  private secondsToBarrier(lane: number): number | null {
    const r = this.rows.find((x) => x.s > this.s && x.blocked[lane]);
    return r ? (r.s - this.s) / this.level.speed : null;
  }

  request(): DecisionRequest | null {
    if (this.done || this.t < this.nextDecisionT) return null;
    const lanes = (list: number[]) => (list.length === 1 ? `lane ${list[0]! + 1}` : `lanes ${list.map((l) => l + 1).join(", ")}`);
    const lines = [
      "You drive a car on a straight five-lane road at night. Lanes are numbered 1 (left) to 5 (right).",
      `You are in lane ${this.lane + 1}. Speed ${this.level.speed} m/s: you cover ${this.level.speed} metres every second.`,
      "Each answer moves the car at most one lane. Hitting a barrier costs far more than missing a coin.",
      "",
      "BARRIERS AHEAD",
    ];
    const ahead = this.ahead();
    for (const r of ahead) lines.push(`- ${Math.round(r.s - this.s)} m: ${lanes(r.blocked.flatMap((b, i) => (b ? [i] : [])))} blocked`);
    if (!ahead.length) lines.push("- none in sight");
    const coins = this.coins.filter((c) => !c.taken && c.s > this.s && c.s - this.s <= VIEW_AHEAD_M);
    lines.push("", "COINS AHEAD", ...(coins.length ? coins.map((c) => `- lane ${c.lane + 1} at ${Math.round(c.s - this.s)} m`) : ["- none in sight"]));

    if (this.facts) {
      lines.push("", "FACTS (seconds until the next barrier in each lane at the current speed)");
      for (let l = 0; l < LANES; l++) {
        const sec = this.secondsToBarrier(l);
        const tag = l === this.lane ? " (your lane)" : Math.abs(l - this.lane) === 1 ? ` (reachable: ${l < this.lane ? "left" : "right"})` : "";
        lines.push(`- lane ${l + 1}${tag}: ${sec === null ? "clear to the end" : `barrier in ${sec.toFixed(1)} s`}`);
      }
      if (this.lane === 0) lines.push("- moving left is impossible: you are in lane 1");
      if (this.lane === LANES - 1) lines.push("- moving right is impossible: you are in lane 5");
    }
    return { id: `m${++this.seq}`, state: lines.join("\n"), questions: QUESTIONS, context: { lane: this.lane, s: this.s } };
  }

  apply(_req: DecisionRequest, answers: Answers, meta: ApplyMeta): void {
    this.nextDecisionT = this.t + DECIDE_EVERY_S;
    this.m.decisions++;
    this.m.staleSum += meta.staleS;
    if (meta.error) this.feedLine({ t: this.t, kind: "alert", who: "SYS", text: `No usable answer from ${meta.deciderLabel}: ${meta.error.slice(0, 120)}` });
    const move = choiceOf(answers, "move");
    const target = move === "left" ? this.lane - 1 : move === "right" ? this.lane + 1 : this.lane;
    if (target < 0 || target >= LANES || target === this.lane) return;
    this.prevLane = this.lane;
    this.lane = target;
    this.laneChangedAt = this.t;
    this.m.moves++;
    this.feedLine({ t: this.t, kind: "decision", text: `${move} to lane ${target + 1}`, latencyMs: meta.latencyMs || undefined });
  }

  private feedLine(line: FeedLine): void {
    this.lines.push(line);
    if (this.lines.length > FEED_KEEP) this.lines.shift();
  }

  metrics(): Record<string, number> {
    return {
      ...this.m,
      progress: this.s / this.level.length,
      meanStaleS: this.m.decisions ? this.m.staleSum / this.m.decisions : 0,
    };
  }

  score(): number {
    return this.m.coins * 10 - this.m.crashes * 100;
  }

  feed(): FeedLine[] {
    return this.lines.slice(-24);
  }

  view(): HighwayView {
    const lo = this.s - 30;
    const hi = this.s + 170;
    return {
      s: this.s,
      lane: this.lane,
      prevLane: this.prevLane,
      laneChangedAt: this.laneChangedAt,
      t: this.t,
      speed: this.level.speed,
      length: this.level.length,
      rows: this.rows.filter((r) => r.s >= lo && r.s <= hi),
      coins: this.coins.filter((c) => c.s >= lo && c.s <= hi),
      crashes: this.crashTimes.slice(-5),
    };
  }
}
