// Seeded traffic + scripted events. The script never depends on what a controller does,
// so every controller faces exactly the same airspace.
import type { Runway } from "./geometry";
import { Rng } from "./rng";

export interface LevelSpec {
  name: string;
  planes: number;
  /** Seconds over which arrivals spawn. */
  window: number;
  maydays: number;
  fuel: number;
  medical: number;
  closures: number;
}

export const LEVELS: Record<number, LevelSpec> = {
  1: { name: "Quiet morning", planes: 5, window: 360, maydays: 0, fuel: 0, medical: 0, closures: 0 },
  2: { name: "Steady flow", planes: 9, window: 540, maydays: 0, fuel: 1, medical: 0, closures: 0 },
  3: { name: "Wind shear", planes: 12, window: 600, maydays: 1, fuel: 1, medical: 0, closures: 1 },
  4: { name: "Rush hour", planes: 16, window: 660, maydays: 1, fuel: 1, medical: 1, closures: 1 },
  5: { name: "Everything at once", planes: 22, window: 720, maydays: 2, fuel: 2, medical: 1, closures: 2 },
};

export interface SpawnSpec {
  t: number;
  id: string;
  telephony: string;
  type: string;
  /** Bearing from the airport to the spawn point. */
  bearing: number;
  headingOffset: number;
  alt: number;
  spd: number;
  fuel: number;
  checkIn: string;
}

export type ScriptEvent =
  | { t: number; kind: "mayday" | "fuel" | "medical"; target: string; text: string }
  | { t: number; kind: "close" | "open"; runway: Runway; text: string };

export interface Scenario {
  level: number;
  seed: number;
  spawns: SpawnSpec[];
  events: ScriptEvent[];
  timeLimit: number;
}

const AIRLINES = [
  ["DAL", "Delta"],
  ["AZU", "Azul"],
  ["GLO", "Gol"],
  ["TAM", "Tam"],
  ["UAL", "United"],
  ["AAL", "American"],
  ["BAW", "Speedbird"],
  ["AFR", "Airfrance"],
  ["DLH", "Lufthansa"],
  ["KLM", "KLM"],
  ["IBE", "Iberia"],
  ["TAP", "Air Portugal"],
  ["AVA", "Avianca"],
  ["CMP", "Copa"],
  ["ACA", "Air Canada"],
  ["SWR", "Swiss"],
] as const;

const TYPES = ["A320", "A20N", "A21N", "B738", "B38M", "E195", "A332", "B789", "B77W"] as const;
const ATIS = ["Kilo", "Lima", "Mike", "November", "Oscar"] as const;

const CHECK_IN = [
  (tel: string, alt: number) => `Approach, ${tel}, with you at ${alt}, inbound.`,
  (tel: string, alt: number, atis: string) => `Good day approach, ${tel}, descending through ${alt + 400}, information ${atis}.`,
  (tel: string, alt: number) => `${tel}, level ${alt}, requesting vectors for the ILS.`,
];

const MAYDAY = [
  (tel: string) => `Mayday, mayday, mayday, ${tel}, engine fire, we need to land immediately.`,
  (tel: string) => `Mayday mayday mayday, ${tel}, smoke in the cockpit, request immediate landing.`,
  (tel: string) => `${tel}, MAYDAY, fire warning on engine two, need the nearest runway now.`,
];

const FUEL = [
  (tel: string) => `Pan-pan, pan-pan, ${tel}, minimum fuel, we can accept about five minutes of delay at most.`,
  (tel: string) => `${tel}, declaring minimum fuel, request priority for the approach.`,
];

const MEDICAL = [
  (tel: string) => `Pan-pan, ${tel}, medical emergency on board, passenger unconscious, request priority.`,
  (tel: string) => `${tel}, we have a passenger with severe chest pains, request expedited arrival.`,
];

const CLOSE = [
  (rwy: Runway) => `Attention all stations, wind shear reported on short final runway ${rwy}. Runway ${rwy} is closed until further notice.`,
  (rwy: Runway) => `All stations, debris reported on runway ${rwy}. Runway ${rwy} closed for inspection, expect the other runway.`,
];

const OPEN = [
  (rwy: Runway) => `All stations, runway ${rwy} is open again.`,
  (rwy: Runway) => `Runway ${rwy} inspection complete, runway ${rwy} available for landing.`,
];

export function generateScenario(level: number, seed: number): Scenario {
  const spec = LEVELS[level] ?? LEVELS[3]!;
  const rng = new Rng(seed * 7919 + level * 104729);

  const spawns: SpawnSpec[] = [];
  const ids = new Set<string>();
  const gap = spec.window / spec.planes;
  for (let i = 0; i < spec.planes; i++) {
    const t = i === 0 ? 5 : Math.round(i * gap + rng.range(-0.35, 0.35) * gap);

    // Keep arrivals that spawn close in time away from each other.
    let b = rng.range(0, 360);
    for (let tries = 0; tries < 30; tries++) {
      const clash = spawns.some((s) => Math.abs(s.t - t) < 90 && Math.abs(((b - s.bearing + 540) % 360) - 180) < 35);
      if (!clash) break;
      b = rng.range(0, 360);
    }

    let id = "";
    let telephony = "";
    while (!id || ids.has(id)) {
      const [code, tel] = rng.pick(AIRLINES);
      const num = rng.int(12, 989);
      id = `${code}${num}`;
      telephony = `${tel} ${num}`;
    }
    ids.add(id);

    const alt = rng.pick([7000, 8000, 9000, 10000, 11000, 12000]);
    spawns.push({
      t,
      id,
      telephony,
      type: rng.pick(TYPES),
      bearing: b,
      headingOffset: rng.range(-25, 25),
      alt,
      spd: 250,
      fuel: Math.round(rng.range(15, 26)),
      checkIn: rng.pick(CHECK_IN)(telephony, alt, rng.pick(ATIS)),
    });
  }
  spawns.sort((a, b) => a.t - b.t);

  const events: ScriptEvent[] = [];
  const eligible = spawns.filter((s) => s.t < spec.window - 60);
  const takeTarget = () => {
    const i = rng.int(0, eligible.length - 1);
    return eligible.splice(i, 1)[0]!;
  };
  for (let i = 0; i < spec.maydays && eligible.length; i++) {
    const s = takeTarget();
    events.push({ t: Math.round(s.t + rng.range(90, 180)), kind: "mayday", target: s.id, text: rng.pick(MAYDAY)(s.telephony) });
  }
  for (let i = 0; i < spec.fuel && eligible.length; i++) {
    const s = takeTarget();
    events.push({ t: Math.round(s.t + rng.range(60, 150)), kind: "fuel", target: s.id, text: rng.pick(FUEL)(s.telephony) });
  }
  for (let i = 0; i < spec.medical && eligible.length; i++) {
    const s = takeTarget();
    events.push({ t: Math.round(s.t + rng.range(60, 150)), kind: "medical", target: s.id, text: rng.pick(MEDICAL)(s.telephony) });
  }

  let runway: Runway = rng.chance(0.5) ? "09L" : "09R";
  let start = Math.round(spec.window * rng.range(0.3, 0.45));
  for (let i = 0; i < spec.closures; i++) {
    const end = start + Math.round(rng.range(150, 280));
    events.push({ t: start, kind: "close", runway, text: rng.pick(CLOSE)(runway) });
    events.push({ t: end, kind: "open", runway, text: rng.pick(OPEN)(runway) });
    runway = runway === "09L" ? "09R" : "09L";
    start = end + Math.round(rng.range(60, 120));
  }
  events.sort((a, b) => a.t - b.t);

  return { level, seed, spawns, events, timeLimit: spec.window + 900 };
}
