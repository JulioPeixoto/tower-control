// Runs one world per controller in lockstep, for any arena game.
//  - turn:     the world waits while a controller decides. Measures decision quality.
//  - realtime: the world keeps moving; answers land on a newer world than the one asked about.
import type { LaneStats } from "../protocol";
import type { RunRecord } from "../runs";
import { sleep } from "../runtime";
import type { Decider } from "./deciders";
import type { ArenaConfig, ArenaFrame, ArenaLaneResult } from "./protocol";
import type { Answers, DecisionRequest, DecisionResult, GameDef, GameWorld } from "./types";

const REALTIME_TICK_MS = 40;
const FRAME_EVERY_MS = 100;
const SETTLE_TIMEOUT_MS = 20_000;
const MAX_DECISIONS_PER_TURN = 50;

export interface ArenaDecisionLog {
  id: string;
  t0: number;
  t1: number;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  invalid: number;
  answers: Answers;
  error?: string;
}

interface Lane {
  decider: Decider;
  world: GameWorld;
  busy: boolean;
  pendingT0?: number;
  inflight?: Promise<void>;
  log: ArenaDecisionLog[];
}

let nextMatchId = 1;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

export class ArenaMatch {
  readonly id = nextMatchId++;
  readonly lanes: Lane[];
  private running = false;
  private lastFrameAt = 0;
  onFrame?: (frame: ArenaFrame) => void;

  constructor(
    readonly game: GameDef,
    readonly config: ArenaConfig,
    deciders: Decider[],
    private readonly headless = false,
  ) {
    this.lanes = deciders.map((decider) => ({
      decider,
      world: game.createWorld(config.level, config.seed, config.options),
      busy: false,
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
    const dt = this.game.dt;
    while (this.running && !this.done) {
      // Answer everything each world is waiting on before time moves.
      for (let i = 0; i < MAX_DECISIONS_PER_TURN && this.running; i++) {
        const asks = this.lanes
          .filter((l) => !l.world.done)
          .map((l) => [l, l.world.request()] as const)
          .filter((pair): pair is readonly [Lane, DecisionRequest] => pair[1] !== null);
        if (!asks.length) break;
        this.emit(true);
        await Promise.all(asks.map(([lane, req]) => this.decide(lane, req)));
      }
      this.stepAll(dt);
      if (this.headless) continue;
      this.emit();
      await sleep((dt * 1000) / this.config.speed);
    }
  }

  private async runRealtime(): Promise<void> {
    const dt = this.game.dt;
    let last = performance.now();
    while (this.running && !this.done) {
      await sleep(REALTIME_TICK_MS);
      const now = performance.now();
      let simDt = ((now - last) / 1000) * this.config.speed;
      last = now;
      while (simDt > 1e-9) {
        const step = Math.min(dt, simDt);
        this.stepAll(step);
        simDt -= step;
      }
      for (const lane of this.lanes) {
        if (lane.busy || lane.world.done) continue;
        const req = lane.world.request();
        if (req) lane.inflight = this.decide(lane, req);
      }
      this.emit();
    }
  }

  private async decide(lane: Lane, req: DecisionRequest): Promise<void> {
    const w = lane.world;
    const t0 = w.t;
    lane.busy = true;
    lane.pendingT0 = t0;
    const wall0 = performance.now();
    let d: DecisionResult;
    try {
      d = await lane.decider.decide(req, w);
    } catch (e) {
      d = {
        answers: {},
        invalid: Object.keys(req.questions).length,
        latencyMs: performance.now() - wall0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    const t1 = w.t;
    if (!w.done) w.apply(req, d.answers, { latencyMs: Math.round(d.latencyMs), staleS: t1 - t0, deciderLabel: lane.decider.label, error: d.error });
    lane.log.push({
      id: req.id,
      t0,
      t1,
      latencyMs: Math.round(d.latencyMs),
      costUsd: d.costUsd,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      reasoningTokens: d.reasoningTokens,
      invalid: d.invalid,
      answers: d.answers,
      error: d.error,
    });
    lane.busy = false;
    lane.pendingT0 = undefined;
  }

  private stats(lane: Lane): LaneStats {
    const ok = lane.log.filter((d) => !d.error);
    const stale = lane.log.map((d) => d.t1 - d.t0);
    return {
      calls: lane.log.length,
      errors: lane.log.length - ok.length,
      p50Ms: percentile(ok.map((d) => d.latencyMs), 50),
      p95Ms: percentile(ok.map((d) => d.latencyMs), 95),
      costUsd: lane.log.reduce((s, d) => s + d.costUsd, 0),
      inputTokens: lane.log.reduce((s, d) => s + d.inputTokens, 0),
      outputTokens: lane.log.reduce((s, d) => s + d.outputTokens, 0),
      meanStaleS: stale.length ? stale.reduce((s, v) => s + v, 0) / stale.length : null,
    };
  }

  frame(): ArenaFrame {
    return {
      type: "frame",
      matchId: this.id,
      t: this.t,
      config: this.config,
      done: this.done,
      lanes: this.lanes.map((l) => ({
        id: l.decider.id,
        label: l.decider.label,
        kind: l.decider.kind,
        model: l.decider.model,
        view: l.world.view(),
        busy: l.busy,
        viewAgeS: l.pendingT0 !== undefined ? l.world.t - l.pendingT0 : 0,
        stats: this.stats(l),
        score: l.world.score(),
        metrics: l.world.metrics(),
        feed: l.world.feed(),
        done: l.world.done,
      })),
    };
  }

  private emit(force = false): void {
    if (!this.onFrame) return;
    const now = performance.now();
    if (!force && now - this.lastFrameAt < FRAME_EVERY_MS) return;
    this.lastFrameAt = now;
    this.onFrame(this.frame());
  }

  results(): ArenaLaneResult[] {
    return this.lanes.map((l) => ({
      id: l.decider.id,
      label: l.decider.label,
      score: l.world.score(),
      metrics: l.world.metrics(),
      stats: this.stats(l),
    }));
  }

  /** The full run: config, final metrics and every decision. Saved to disk by the CLI, downloaded in the browser. */
  record(stopped: boolean): RunRecord {
    const { level, seed, mode } = this.config;
    return {
      name: `${this.game.id}-L${level}-s${seed}-${mode}`,
      game: this.game.id,
      config: this.config,
      level: this.game.levels[level],
      savedAt: new Date().toISOString(),
      stopped,
      simTime: this.t,
      lanes: this.lanes.map((l) => ({
        id: l.decider.id,
        label: l.decider.label,
        kind: l.decider.kind,
        model: l.decider.model,
        score: l.world.score(),
        metrics: l.world.metrics(),
        stats: this.stats(l),
        decisions: l.log,
      })),
    };
  }
}
