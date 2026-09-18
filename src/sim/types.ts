import type { Action } from "./commands";
import type { Runway } from "./geometry";

export type Phase = "vectoring" | "holding" | "approach" | "final" | "landed" | "crashed" | "exited";
export const AIRBORNE: ReadonlySet<Phase> = new Set<Phase>(["vectoring", "holding", "approach", "final"]);

export type EmergencyKind = "mayday" | "fuel" | "medical";

export interface Aircraft {
  id: string;
  telephony: string;
  type: string;
  x: number;
  y: number;
  hdg: number;
  alt: number;
  spd: number;
  tgtHdg: number;
  tgtAlt: number;
  tgtSpd: number;
  /** Minutes of fuel left. */
  fuel: number;
  phase: Phase;
  runway?: Runway;
  emergency?: { kind: EmergencyKind; since: number; deadline?: number };
  spawnT: number;
  doneT?: number;
  /** Seconds a direct flight from the spawn point would take; used for excess delay. */
  nominal: number;
  goArounds: number;
  trail: [number, number][];
}

export type RadioKind = "call" | "emergency" | "notice" | "atc" | "alert" | "event";

export interface RadioLine {
  t: number;
  from: string;
  to?: string;
  text: string;
  kind: RadioKind;
  latencyMs?: number;
  staleS?: number;
}

export interface Command {
  id: string;
  action: Action;
  heading?: number;
  altitude?: number;
  speed?: number;
}

export interface Metrics {
  spawned: number;
  landed: number;
  crashed: number;
  exited: number;
  collisionLosses: number;
  fuelOuts: number;
  emergencyLosses: number;
  goArounds: number;
  losEvents: number;
  conflictSeconds: number;
  emergencyLate: number;
  /** Landing clearances refused by the pilot (too far out). */
  rejected: number;
  /** Instructions that changed something. */
  instructions: number;
  /** Non-"continue" answers for aircraft that were already on final, landed or lost. */
  moot: number;
  excessDelay: number[];
}

export interface AircraftView {
  id: string;
  type: string;
  x: number;
  y: number;
  alt: number;
  tgtAlt: number;
  spd: number;
  hdg: number;
  phase: Phase;
  runway?: Runway;
  emergency?: EmergencyKind;
  fuel: number;
  trail: [number, number][];
}

export interface WorldView {
  t: number;
  aircraft: AircraftView[];
  conflicts: [string, string][];
  closed: Runway[];
  metrics: Metrics;
  radio: RadioLine[];
  done: boolean;
}
