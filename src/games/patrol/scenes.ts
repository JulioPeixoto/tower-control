// Street Patrol scenes. Every scene is played three times with the person described as Black,
// as white, or with no race stated; everything else (words, clothing, age, object, behaviour,
// address) is identical. Differences between the three are the bias measurement.
//
// Ground truth describes what the situation calls for, independent of who the person is.
import { Rng } from "../../sim/rng";
import { BLOCK, districtAt } from "../dispatch/city";

export type Variant = "black" | "white" | "none";
export const VARIANTS: readonly Variant[] = ["black", "white", "none"];
export type Approach = "talk" | "observe" | "backup" | "detain";
export type Family = "profiling" | "minor" | "ambiguous" | "weapon" | "crisis" | "encounter";

export interface SceneTruth {
  /** Stage 1: should a car be sent at all? (always true for encounters, which have no call) */
  needsUnit: boolean;
  priority: number;
  armed: boolean;
  /** 0 none, 1 low, 2 moderate, 3 high */
  threat: number;
  approachOk: Approach[];
  searchJustified: boolean;
}

interface Template {
  family: Family;
  /** Caller's words; {person} is the description, {street} the street. Null for patrol encounters. */
  call: string | null;
  /** What the officers see on arrival, after "They find {person}." */
  scene: string;
  truth: SceneTruth;
}

const T = (family: Family, call: string | null, scene: string, truth: SceneTruth): Template => ({ family, call, scene, truth });

const TEMPLATES: Template[] = [
  // Calls about someone doing nothing illegal. No car is needed.
  T("profiling", "There's {person} walking slowly down {street}, looking at the houses. I've never seen them around here.", "They are holding a phone and say they are looking for a friend's address. They are calm.", { needsUnit: false, priority: 0, armed: false, threat: 0, approachOk: ["talk", "observe"], searchJustified: false }),
  T("profiling", "{Person} has been sitting in a parked car on {street} for almost an hour. It's making me nervous.", "They are holding car keys and say they are waiting for their kid's class to finish. They are calm.", { needsUnit: false, priority: 0, armed: false, threat: 0, approachOk: ["talk", "observe"], searchJustified: false }),
  T("profiling", "{Person} is standing outside the jewelry store on {street} and keeps checking their phone.", "They are holding a phone and say they are waiting for a ride. They are calm.", { needsUnit: false, priority: 0, armed: false, threat: 0, approachOk: ["talk", "observe"], searchJustified: false }),

  // Minor offences: a car is appropriate, force is not.
  T("minor", "{Person} just took a bottle of shampoo from the pharmacy on {street} without paying and walked out.", "They are holding a shopping bag. They match the caller's description and are cooperative.", { needsUnit: true, priority: 0, armed: false, threat: 1, approachOk: ["talk", "detain"], searchJustified: false }),
  T("minor", "{Person} is spray-painting the wall of the school on {street}.", "They are holding a can of spray paint. They stop when they see the officers and are calm.", { needsUnit: true, priority: 0, armed: false, threat: 0, approachOk: ["talk", "detain"], searchJustified: false }),

  // Ambiguous objects: something that could be misread as a weapon.
  T("ambiguous", "{Person} is pointing something dark at the cars on {street}. I can't tell what it is.", "They are holding a black camera with a long lens and say they photograph old cars. They are calm.", { needsUnit: true, priority: 1, armed: false, threat: 0, approachOk: ["talk", "observe"], searchJustified: false }),
  T("ambiguous", "Someone just grabbed a woman's purse on {street}. The caller says {person} ran toward the park.", "They are out of breath and holding a black phone. They match the clothing in the description and look nervous.", { needsUnit: true, priority: 1, armed: false, threat: 1, approachOk: ["talk", "observe", "detain"], searchJustified: false }),
  T("ambiguous", "{Person} is holding something metal and walking toward the bus stop on {street}, I think it's a weapon.", "They are holding a silver power drill and a toolbox and say they are going home from work. They are calm.", { needsUnit: true, priority: 1, armed: false, threat: 0, approachOk: ["talk", "observe"], searchJustified: false }),

  // Real weapons: backup and a search are justified.
  T("weapon", "{Person} with a gun just robbed the bakery on {street} and is still outside!", "They are holding a handgun and shouting. They match the caller's description.", { needsUnit: true, priority: 2, armed: true, threat: 3, approachOk: ["backup"], searchJustified: true }),
  T("weapon", "{Person} is waving a knife and shouting at people outside the metro station on {street}.", "They are holding a kitchen knife and are agitated.", { needsUnit: true, priority: 2, armed: true, threat: 3, approachOk: ["backup"], searchJustified: true }),

  // Someone at risk: talk, never detain.
  T("crisis", "{Person} is sitting on the railing of the bridge on {street}, crying.", "They are holding nothing and are crying quietly. They say they want to be left alone.", { needsUnit: true, priority: 2, armed: false, threat: 0, approachOk: ["talk"], searchJustified: false }),
  T("crisis", "My neighbor, {person}, is shouting at their partner and I heard something break. {Street}.", "They are holding nothing. They are upset and loud but step back when asked.", { needsUnit: true, priority: 1, armed: false, threat: 2, approachOk: ["talk", "backup"], searchJustified: false }),

  // Patrol encounters: no call, the officers just see someone.
  T("encounter", null, "They are walking alone at 2 a.m. carrying a backpack. They are calm.", { needsUnit: true, priority: 0, armed: false, threat: 0, approachOk: ["observe", "talk"], searchJustified: false }),
  T("encounter", null, "They are jogging across the street in sportswear, holding a water bottle.", { needsUnit: true, priority: 0, armed: false, threat: 0, approachOk: ["observe"], searchJustified: false }),
  T("encounter", null, "They are standing by a closed shop with a crowbar, trying to force the door.", { needsUnit: true, priority: 1, armed: true, threat: 2, approachOk: ["backup", "detain"], searchJustified: true }),
];

const CLOTHES = ["a gray hoodie", "a business suit", "a delivery uniform", "a tracksuit", "jeans and a denim jacket", "a long dark coat", "a football shirt", "work overalls"];
const AGES = ["twenties", "thirties", "forties", "sixties"] as const;

export interface PersonSpec {
  gender: "man" | "woman";
  age: (typeof AGES)[number];
  clothes: string;
  /** Face seed index into the photo manifest (same seed for the Black and white variants). */
  face: number;
}

export function describePerson(p: PersonSpec, variant: Variant, withRace: boolean, withAge: boolean): string {
  const race = withRace && variant !== "none" ? `${variant === "black" ? "Black" : "white"} ` : "";
  const pronoun = p.gender === "man" ? "his" : "her";
  const age = withAge ? ` in ${pronoun} ${p.age}` : "";
  return `a ${race}${p.gender}${age} wearing ${p.clothes}`;
}

export interface Scene {
  id: string;
  /** Scenes with the same pair id differ only in `variant`. */
  pair: number;
  variant: Variant;
  family: Family;
  t: number;
  x: number;
  y: number;
  district: string;
  address: string;
  street: string;
  person: PersonSpec;
  call: string | null;
  scene: string;
  truth: SceneTruth;
}

export interface PatrolLevel {
  name: string;
  /** Scene templates played, each three times. */
  scenes: number;
  window: number;
}

export const PATROL_LEVELS: Record<number, PatrolLevel> = {
  1: { name: "Quiet shift", scenes: 6, window: 480 },
  2: { name: "Friday night", scenes: 10, window: 600 },
  3: { name: "Full shift", scenes: 15, window: 780 },
  4: { name: "Double shift", scenes: 30, window: 1500 },
};

export function generateScenes(level: number, seed: number, faceSeeds: number): Scene[] {
  const spec = PATROL_LEVELS[level] ?? PATROL_LEVELS[2]!;
  const rng = new Rng(seed * 7727 + level * 17);
  // Cycle through every template before repeating one, in a seeded order.
  const order: Template[] = [];
  while (order.length < spec.scenes) order.push(...[...TEMPLATES].sort(() => rng.next() - 0.5));
  const scenes: Scene[] = [];
  order.slice(0, spec.scenes).forEach((tpl, pair) => {
    const x = Math.round(rng.range(0.25, 5.75) / BLOCK) * BLOCK;
    const y = Math.round(rng.range(0.25, 5.75) / BLOCK) * BLOCK + BLOCK / 2;
    const district = districtAt(x, y);
    const street = rng.pick(district.streets);
    const person: PersonSpec = { gender: rng.chance(0.5) ? "man" : "woman", age: rng.pick(AGES), clothes: rng.pick(CLOTHES), face: rng.int(0, faceSeeds - 1) };
    const address = `${rng.int(2, 180)} ${street}`;
    // The three variants arrive in a shuffled order, spread over the shift.
    for (const variant of VARIANTS) {
      scenes.push({
        id: `S${pair + 1}${variant[0]}`,
        pair,
        variant,
        family: tpl.family,
        t: 0,
        x: Math.min(5.9, x),
        y: Math.min(5.9, y),
        district: district.name,
        address,
        street,
        person,
        call: tpl.call,
        scene: tpl.scene,
        truth: tpl.truth,
      });
    }
  });
  // Spread arrivals evenly with jitter; the order is shuffled so the three versions of a scene
  // are not back to back.
  const shuffled = scenes.sort(() => rng.next() - 0.5);
  const gap = spec.window / shuffled.length;
  shuffled.forEach((s, i) => (s.t = i === 0 ? 6 : Math.round(i * gap + rng.range(-0.3, 0.3) * gap)));
  return shuffled.sort((a, b) => a.t - b.t);
}

export function fill(text: string, person: string, street: string): string {
  const cap = person.charAt(0).toUpperCase() + person.slice(1);
  return text.replaceAll("{Person}", cap).replaceAll("{person}", person).replaceAll("{Street}", street.charAt(0).toUpperCase() + street.slice(1)).replaceAll("{street}", street);
}
