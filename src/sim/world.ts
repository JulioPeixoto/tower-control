import { pad3 } from "./commands";
import {
  CLEARANCE_RANGE,
  COLLISION_FT,
  COLLISION_NM,
  FIX_ALT,
  FIX_DISTANCE,
  FIX_MAX_ALT,
  ORIGIN,
  RADAR_RANGE,
  RUNWAY_GEOMETRY,
  RUNWAY_OCCUPANCY_S,
  SEP_FINAL_NM,
  SEP_FT,
  SEP_NM,
  SPAWN_RADIUS,
  bearing,
  dist,
  norm360,
  rad,
  turnDelta,
  type Runway,
} from "./geometry";
import type { Scenario, ScriptEvent, SpawnSpec } from "./scenario";
import { AIRBORNE, type Aircraft, type Command, type Metrics, type RadioKind, type RadioLine, type WorldView } from "./types";

const TURN_DPS = 3;
const DESCENT_FPS = 2000 / 60;
const CLIMB_FPS = 1500 / 60;
const ACCEL_KPS = 1.5;
const HOLD_MAX_KT = 210;
const FINAL_KT = 160;
const TRAIL_EVERY_S = 4;
const TRAIL_LENGTH = 8;
const RADIO_KEEP = 80;
export const MAYDAY_DEADLINE_S = 360;
export const MEDICAL_DEADLINE_S = 480;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function emptyMetrics(): Metrics {
  return {
    spawned: 0,
    landed: 0,
    crashed: 0,
    exited: 0,
    collisionLosses: 0,
    fuelOuts: 0,
    emergencyLosses: 0,
    goArounds: 0,
    losEvents: 0,
    conflictSeconds: 0,
    emergencyLate: 0,
    rejected: 0,
    instructions: 0,
    moot: 0,
    excessDelay: [],
  };
}

/** One point per landing, heavy penalties for losses and separation busts. */
export function score(m: Metrics): number {
  const delayMin = m.excessDelay.reduce((s, d) => s + Math.max(0, d), 0) / 60;
  return Math.round(
    m.landed * 100 - m.crashed * 1000 - m.exited * 300 - m.losEvents * 50 - m.goArounds * 25 - m.emergencyLate * 150 - delayMin * 5,
  );
}

export class World {
  t = 0;
  readonly aircraft: Aircraft[] = [];
  readonly radio: RadioLine[] = [];
  readonly metrics = emptyMetrics();
  private readonly pinned = new Map<string, RadioLine>();
  private readonly notices = new Map<Runway, RadioLine>();
  private readonly lastLanding: Record<Runway, number> = { "09L": -Infinity, "09R": -Infinity };
  private conflicts = new Set<string>();
  private nextSpawn = 0;
  private nextEvent = 0;
  private trailClock = 0;

  constructor(readonly scenario: Scenario) {}

  get done(): boolean {
    if (this.t >= this.scenario.timeLimit) return true;
    return this.nextSpawn >= this.scenario.spawns.length && this.airborne().length === 0;
  }

  airborne(): Aircraft[] {
    return this.aircraft.filter((a) => AIRBORNE.has(a.phase));
  }

  find(id: string): Aircraft | undefined {
    return this.aircraft.find((a) => a.id === id);
  }

  lastLandingAt(rwy: Runway): number {
    return this.lastLanding[rwy];
  }

  /** Free-text notices (runway closures). Deliberately not exposed as structured flags. */
  noticeLines(): RadioLine[] {
    return [...this.notices.values()];
  }

  /** Emergency calls from aircraft that are still airborne. */
  pinnedLines(): RadioLine[] {
    return [...this.pinned.values()];
  }

  step(dt: number): void {
    this.t += dt;
    this.runScript();
    for (const a of this.airborne()) this.fly(a, dt);
    this.checkSeparation(dt);
    this.trailClock += dt;
    if (this.trailClock >= TRAIL_EVERY_S) {
      this.trailClock = 0;
      for (const a of this.airborne()) {
        a.trail.push([a.x, a.y]);
        if (a.trail.length > TRAIL_LENGTH) a.trail.shift();
      }
    }
  }

  say(from: string, text: string, kind: RadioKind, extra: Partial<RadioLine> = {}): RadioLine {
    const line: RadioLine = { t: this.t, from, text, kind, ...extra };
    this.radio.push(line);
    if (this.radio.length > RADIO_KEEP) this.radio.shift();
    return line;
  }

  applyCommands(commands: Command[], meta: { latencyMs?: number; staleS?: number } = {}): void {
    for (const cmd of commands) {
      const a = this.find(cmd.id);
      if (!a || !AIRBORNE.has(a.phase) || a.phase === "final") {
        if (cmd.action !== "continue") this.metrics.moot++;
        continue;
      }
      const parts = this.instruct(a, cmd);
      if (parts.length) {
        this.metrics.instructions++;
        this.say("APP", parts.join(", "), "atc", { to: a.id, ...meta });
      }
    }
  }

  view(): WorldView {
    return {
      t: this.t,
      aircraft: this.airborne().map((a) => ({
        id: a.id,
        type: a.type,
        x: a.x,
        y: a.y,
        alt: a.alt,
        tgtAlt: a.tgtAlt,
        spd: a.spd,
        hdg: a.hdg,
        phase: a.phase,
        runway: a.runway,
        emergency: a.emergency?.kind,
        fuel: a.fuel,
        trail: a.trail,
      })),
      conflicts: [...this.conflicts].map((k) => k.split("|") as [string, string]),
      closed: [...this.notices.keys()],
      metrics: this.metrics,
      radio: this.radio.slice(-24),
      done: this.done,
    };
  }

  // --- script -------------------------------------------------------------

  private runScript(): void {
    const { spawns, events } = this.scenario;
    while (this.nextSpawn < spawns.length && spawns[this.nextSpawn]!.t <= this.t) this.spawn(spawns[this.nextSpawn++]!);
    while (this.nextEvent < events.length && events[this.nextEvent]!.t <= this.t) this.trigger(events[this.nextEvent++]!);
  }

  private spawn(s: SpawnSpec): void {
    const hdg = norm360(s.bearing + 180 + s.headingOffset);
    this.aircraft.push({
      id: s.id,
      telephony: s.telephony,
      type: s.type,
      x: Math.sin(rad(s.bearing)) * SPAWN_RADIUS,
      y: Math.cos(rad(s.bearing)) * SPAWN_RADIUS,
      hdg,
      alt: s.alt,
      spd: s.spd,
      tgtHdg: hdg,
      tgtAlt: s.alt,
      tgtSpd: s.spd,
      fuel: s.fuel,
      phase: "vectoring",
      spawnT: this.t,
      nominal: (SPAWN_RADIUS + FIX_DISTANCE) / (s.spd / 3600),
      goArounds: 0,
      trail: [],
    });
    this.metrics.spawned++;
    this.say(s.id, s.checkIn, "call");
  }

  private trigger(ev: ScriptEvent): void {
    if ("runway" in ev) {
      const line = this.say("ATIS", ev.text, "notice");
      if (ev.kind === "close") this.notices.set(ev.runway, line);
      else this.notices.delete(ev.runway);
      return;
    }
    const a = this.find(ev.target);
    if (!a || !AIRBORNE.has(a.phase) || a.emergency) return;
    if (ev.kind === "mayday") a.emergency = { kind: "mayday", since: this.t, deadline: this.t + MAYDAY_DEADLINE_S };
    else if (ev.kind === "medical") a.emergency = { kind: "medical", since: this.t, deadline: this.t + MEDICAL_DEADLINE_S };
    else {
      a.fuel = Math.min(a.fuel, 6);
      a.emergency = { kind: "fuel", since: this.t };
    }
    this.pinned.set(a.id, this.say(a.id, ev.text, "emergency"));
  }

  // --- flight -------------------------------------------------------------

  private fly(a: Aircraft, dt: number): void {
    a.fuel -= dt / 60;
    if (a.fuel <= 0) return this.lose(a, "crashed", "ran out of fuel", "fuelOuts");
    if (a.emergency?.kind === "mayday" && this.t > a.emergency.deadline!) {
      return this.lose(a, "crashed", "did not land in time after the mayday", "emergencyLosses");
    }

    let hdgTarget = a.tgtHdg;
    let spdTarget = a.tgtSpd;
    if (a.phase === "approach") {
      const fix = RUNWAY_GEOMETRY[a.runway!].fix;
      a.tgtHdg = hdgTarget = bearing(a, fix);
      a.tgtAlt = FIX_ALT;
      spdTarget = Math.min(spdTarget, HOLD_MAX_KT);
      if (dist(a, fix) < 1) {
        if (a.alt > FIX_MAX_ALT) return this.goAround(a, `too high at the fix, ${Math.round(a.alt)} feet`);
        a.phase = "final";
      }
    } else if (a.phase === "final") {
      const thr = RUNWAY_GEOMETRY[a.runway!].threshold;
      const d = dist(a, thr);
      if (d < 0.5) return this.touchdown(a);
      a.tgtHdg = hdgTarget = bearing(a, thr);
      a.tgtAlt = Math.round(clamp((FIX_ALT * d) / FIX_DISTANCE, 0, FIX_ALT));
      spdTarget = FINAL_KT;
    } else if (a.phase === "holding") {
      hdgTarget = a.hdg + 90;
      spdTarget = Math.min(spdTarget, HOLD_MAX_KT);
    }

    const maxTurn = TURN_DPS * dt;
    a.hdg = norm360(a.hdg + clamp(turnDelta(a.hdg, hdgTarget), -maxTurn, maxTurn));
    a.alt += clamp(a.tgtAlt - a.alt, -DESCENT_FPS * dt, CLIMB_FPS * dt);
    a.spd += clamp(spdTarget - a.spd, -ACCEL_KPS * dt, ACCEL_KPS * dt);
    const v = (a.spd / 3600) * dt;
    a.x += Math.sin(rad(a.hdg)) * v;
    a.y += Math.cos(rad(a.hdg)) * v;

    if ((a.phase === "vectoring" || a.phase === "holding") && dist(a, ORIGIN) > RADAR_RANGE) {
      this.lose(a, "exited", "left radar coverage", null);
    }
  }

  private touchdown(a: Aircraft): void {
    const rwy = a.runway!;
    if (this.notices.has(rwy)) return this.goAround(a, `runway ${rwy} is closed`);
    if (this.t - this.lastLanding[rwy] < RUNWAY_OCCUPANCY_S) return this.goAround(a, `runway ${rwy} occupied`);
    a.phase = "landed";
    a.doneT = this.t;
    this.lastLanding[rwy] = this.t;
    this.metrics.landed++;
    this.metrics.excessDelay.push(this.t - a.spawnT - a.nominal);
    if (a.emergency?.deadline !== undefined && this.t > a.emergency.deadline) this.metrics.emergencyLate++;
    this.pinned.delete(a.id);
    this.say(a.id, `landed runway ${rwy}`, "event");
  }

  private goAround(a: Aircraft, reason: string): void {
    a.phase = "vectoring";
    a.runway = undefined;
    a.tgtHdg = 90;
    a.tgtAlt = 4000;
    a.tgtSpd = 220;
    a.goArounds++;
    this.metrics.goArounds++;
    this.say(a.id, `${a.telephony}, going around, ${reason}.`, "alert");
  }

  private lose(a: Aircraft, phase: "crashed" | "exited", reason: string, cause: "fuelOuts" | "emergencyLosses" | "collisionLosses" | null): void {
    a.phase = phase;
    a.doneT = this.t;
    if (phase === "crashed") this.metrics.crashed++;
    else this.metrics.exited++;
    if (cause) this.metrics[cause]++;
    this.pinned.delete(a.id);
    this.say("RADAR", `${a.id} lost: ${reason}.`, "alert");
  }

  private checkSeparation(dt: number): void {
    const air = this.airborne();
    const active = new Set<string>();
    for (let i = 0; i < air.length; i++) {
      for (let j = i + 1; j < air.length; j++) {
        const a = air[i]!;
        const b = air[j]!;
        if (!AIRBORNE.has(a.phase) || !AIRBORNE.has(b.phase)) continue;
        const bothFinal = a.phase === "final" && b.phase === "final";
        if (bothFinal && a.runway !== b.runway) continue;

        const dh = dist(a, b);
        const dv = Math.abs(a.alt - b.alt);
        if (dh < COLLISION_NM && dv < COLLISION_FT) {
          this.lose(a, "crashed", `mid-air collision with ${b.id}`, "collisionLosses");
          this.lose(b, "crashed", `mid-air collision with ${a.id}`, "collisionLosses");
          continue;
        }
        if (dh < (bothFinal ? SEP_FINAL_NM : SEP_NM) && dv < SEP_FT) {
          const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          active.add(key);
          this.metrics.conflictSeconds += dt;
          if (!this.conflicts.has(key)) {
            this.metrics.losEvents++;
            this.say("RADAR", `Separation lost: ${a.id} and ${b.id}, ${dh.toFixed(1)} nm, ${Math.round(dv)} ft.`, "alert");
          }
        }
      }
    }
    this.conflicts = active;
  }

  // --- instructions -------------------------------------------------------

  private instruct(a: Aircraft, cmd: Command): string[] {
    const parts: string[] = [];
    switch (cmd.action) {
      case "continue":
        return parts;
      case "land_09L":
      case "land_09R": {
        const rwy: Runway = cmd.action === "land_09L" ? "09L" : "09R";
        if (a.phase === "approach" && a.runway === rwy) return parts;
        const d = dist(a, ORIGIN);
        if (d > CLEARANCE_RANGE) {
          this.metrics.rejected++;
          this.say(a.id, `${a.telephony}, unable, we are still ${Math.round(d)} miles out.`, "call");
          return parts;
        }
        a.phase = "approach";
        a.runway = rwy;
        parts.push(`cleared ILS runway ${rwy}`);
        return parts;
      }
      case "hold":
        if (a.phase !== "holding") {
          a.phase = "holding";
          a.runway = undefined;
          parts.push("hold at present position");
        }
        this.setAltSpeed(a, cmd, parts);
        return parts;
      case "vector":
        if (a.phase !== "vectoring") {
          if (a.phase === "approach") parts.push("cancel approach clearance");
          a.phase = "vectoring";
          a.runway = undefined;
        }
        if (cmd.heading !== undefined && Math.abs(turnDelta(a.tgtHdg, cmd.heading)) >= 1) {
          parts.push(`turn ${turnDelta(a.hdg, cmd.heading) < 0 ? "left" : "right"} heading ${pad3(cmd.heading)}`);
          a.tgtHdg = cmd.heading;
        }
        this.setAltSpeed(a, cmd, parts);
        return parts;
    }
  }

  private setAltSpeed(a: Aircraft, cmd: Command, parts: string[]): void {
    if (cmd.altitude !== undefined && cmd.altitude !== a.tgtAlt) {
      parts.push(`${cmd.altitude < a.alt ? "descend" : "climb"} ${cmd.altitude}`);
      a.tgtAlt = cmd.altitude;
    }
    if (cmd.speed !== undefined && cmd.speed !== a.tgtSpd) {
      parts.push(`${cmd.speed < a.spd ? "reduce" : "increase"} speed ${cmd.speed}`);
      a.tgtSpd = cmd.speed;
    }
  }
}
