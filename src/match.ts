// Runs every controller on its own copy of the same scenario, in lockstep.
//  - turn:     the world pauses while controllers decide. Measures decision quality only.
//  - realtime: the world keeps moving while controllers decide; answers land on a newer
//              picture than the one they were based on. Latency becomes part of the score.
import type { Controller, Decision } from "./controllers/types";
import type { Frame, LaneFrame, LaneResult, LaneStats, MatchConfig } from "./protocol";
import type { RunRecord } from "./runs";
import { sleep } from "./runtime";
import { describeState } from "./sim/describe";
import { buildQuestions } from "./sim/questions";
import { LEVELS, generateScenario } from "./sim/scenario";
import type { Command } from "./sim/types";
import { World, score } from "./sim/world";

const DT = 0.5;
const REALTIME_TICK_MS = 50;
const FRAME_EVERY_MS = 100;
const SETTLE_TIMEOUT_MS = 20_000;

export interface DecisionLog {
  t0: number;
  t1: number;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  questions: number;
  invalid: number;
  commands: Command[];
  confidence?: Record<string, number>;
  actionProbs?: Record<string, Record<string, number>>;
  error?: string;
}

interface Lane {
  controller: Controller;
  world: World;
  busy: boolean;
  lastDecisionT: number;
  pending?: { t0: number; ghosts: { id: string; x: number; y: number }[] };
  inflight?: Promise<void>;
  log: DecisionLog[];
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

let nextMatchId = 1;

export class Match {
  readonly id = nextMatchId++;
  readonly lanes: Lane[];
  private running = false;
  private lastFrameAt = 0;
  onFrame?: (frame: Frame) => void;

  constructor(
    readonly config: MatchConfig,
    controllers: Controller[],
    private readonly headless = false,
  ) {
    const scenario = generateScenario(config.level, config.seed);
    this.lanes = controllers.map((controller) => ({
      controller,
      world: new World(scenario),
      busy: false,
      lastDecisionT: -Infinity,
      log: [],
    }));
  }

  get t(): number {
    return Math.max(...this.lanes.map((l) => l.world.t));
  }

  get done(): boolean {
    return this.lanes.every((l) => l.world.done);
  }

  get isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
  }

  async run(): Promise<{ stopped: boolean }> {
    this.running = true;
    if (this.config.mode === "turn") await this.runTurn();
    else await this.runRealtime();
    const stopped = !this.done;
    this.running = false;

    const inflight = this.lanes.map((l) => l.inflight).filter(Boolean);
    if (inflight.length) await Promise.race([Promise.all(inflight), sleep(SETTLE_TIMEOUT_MS)]);
    this.emit(true);
    return { stopped };
  }

  private stepAll(dt: number): void {
    for (const lane of this.lanes) if (!lane.world.done) lane.world.step(dt);
  }

  private async runTurn(): Promise<void> {
    let nextDecision = 0;
    while (this.running && !this.done) {
      if (this.t >= nextDecision) {
        this.emit(true);
        await Promise.all(this.lanes.filter((l) => !l.world.done).map((l) => this.decide(l)));
        nextDecision = this.t + this.config.decisionEvery;
      }
      this.stepAll(DT);
      if (this.headless) continue;
      this.emit();
      await sleep((DT * 1000) / this.config.speed);
    }
  }

  private async runRealtime(): Promise<void> {
    let last = performance.now();
    while (this.running && !this.done) {
      await sleep(REALTIME_TICK_MS);
      const now = performance.now();
      let simDt = ((now - last) / 1000) * this.config.speed;
      last = now;
      while (simDt > 1e-9) {
        const dt = Math.min(DT, simDt);
        this.stepAll(dt);
        simDt -= dt;
      }
      for (const lane of this.lanes) {
        if (lane.busy || lane.world.done) continue;
        if (lane.world.t - lane.lastDecisionT < this.config.decisionEvery) continue;
        lane.inflight = this.decide(lane);
      }
      this.emit();
    }
  }

  private async decide(lane: Lane): Promise<void> {
    const w = lane.world;
    const t0 = w.t;
    lane.lastDecisionT = t0;
    const questions = buildQuestions(w);
    if (!questions.length) return;

    lane.busy = true;
    lane.pending = { t0, ghosts: w.airborne().map((a) => ({ id: a.id, x: a.x, y: a.y })) };
    const input = { t: t0, stateText: describeState(w, { facts: this.config.facts }), questions, view: w.view() };
    const wall0 = performance.now();
    let d: Decision;
    try {
      d = await lane.controller.decide(input);
    } catch (e) {
      d = {
        commands: [],
        latencyMs: performance.now() - wall0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const t1 = w.t;
    if (!w.done) {
      w.applyCommands(d.commands, { latencyMs: Math.round(d.latencyMs), staleS: t1 - t0 });
      if (d.error) w.say("SYS", `No usable answer from ${lane.controller.label}: ${d.error.slice(0, 160)}`, "alert");
    }
    lane.log.push({
      t0,
      t1,
      latencyMs: Math.round(d.latencyMs),
      costUsd: d.costUsd,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      reasoningTokens: d.reasoningTokens,
      questions: questions.length,
      invalid: d.invalid ?? 0,
      commands: d.commands.filter((c) => c.action !== "continue"),
      confidence: d.confidence,
      actionProbs: d.actionProbs,
      error: d.error,
    });
    lane.busy = false;
    lane.pending = undefined;
  }

  private stats(lane: Lane): LaneStats {
    const ok = lane.log.filter((d) => !d.error);
    const latencies = ok.map((d) => d.latencyMs);
    const stale = lane.log.map((d) => d.t1 - d.t0);
    return {
      calls: lane.log.length,
      errors: lane.log.length - ok.length,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      costUsd: lane.log.reduce((s, d) => s + d.costUsd, 0),
      inputTokens: lane.log.reduce((s, d) => s + d.inputTokens, 0),
      outputTokens: lane.log.reduce((s, d) => s + d.outputTokens, 0),
      meanStaleS: stale.length ? stale.reduce((s, v) => s + v, 0) / stale.length : null,
    };
  }

  frame(): Frame {
    const lanes: LaneFrame[] = this.lanes.map((l) => ({
      id: l.controller.id,
      label: l.controller.label,
      kind: l.controller.kind,
      model: l.controller.model,
      world: l.world.view(),
      busy: l.busy,
      viewAgeS: l.pending ? l.world.t - l.pending.t0 : 0,
      ghosts: l.pending?.ghosts ?? [],
      stats: this.stats(l),
      score: score(l.world.metrics),
    }));
    return { type: "frame", matchId: this.id, t: this.t, config: this.config, done: this.done, lanes };
  }

  private emit(force = false): void {
    if (!this.onFrame) return;
    const now = performance.now();
    if (!force && now - this.lastFrameAt < FRAME_EVERY_MS) return;
    this.lastFrameAt = now;
    this.onFrame(this.frame());
  }

  results(): LaneResult[] {
    return this.lanes.map((l) => ({
      id: l.controller.id,
      label: l.controller.label,
      score: score(l.world.metrics),
      metrics: l.world.metrics,
      stats: this.stats(l),
    }));
  }

  /** The full run: config, final metrics and every decision. Saved to disk by the CLI, downloaded in the browser. */
  record(stopped: boolean): RunRecord {
    const { level, seed, mode } = this.config;
    return {
      name: `tower-L${level}-s${seed}-${mode}${this.config.facts ? "-facts" : ""}`,
      game: "tower",
      config: this.config,
      level: LEVELS[level]?.name,
      savedAt: new Date().toISOString(),
      stopped,
      simTime: this.t,
      lanes: this.lanes.map((l) => ({
        id: l.controller.id,
        label: l.controller.label,
        kind: l.controller.kind,
        model: l.controller.model,
        score: score(l.world.metrics),
        metrics: l.world.metrics,
        stats: this.stats(l),
        decisions: l.log,
      })),
    };
  }
}
