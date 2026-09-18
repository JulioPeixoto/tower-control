// Parcel labels in free text. The same facts are phrased many ways (grams, pounds, "about a
// dozen kilos", "next-day", "handle with care"), so reading beats keyword matching.
import { Rng } from "../../sim/rng";
import { CITIES, CONTENTS, REGIONS, SERVICES, cutsUsed, type Contents, type Parcel, type Region, type ServiceLevel, type TreeNode } from "./tree";

const ITEMS: Record<Contents, string[]> = {
  electronics: ["a laptop", "two smartphones", "wireless headphones", "a camera and two lenses", "a game console"],
  clothing: ["winter jackets", "a box of T-shirts", "running shoes", "a wedding dress", "wool sweaters"],
  food: ["coffee beans", "boxes of chocolate", "extra-virgin olive oil", "dried fruit", "artisanal cheese"],
  documents: ["signed contracts", "passport applications", "a stack of invoices", "legal case files", "notarised deeds"],
  glassware: ["wine glasses", "a crystal vase", "glass jars", "a framed mirror", "hand-blown bowls"],
  chemicals: ["pool chlorine", "paint thinner", "laboratory reagents", "industrial degreaser", "concentrated bleach"],
  books: ["novels", "a set of encyclopedias", "school textbooks", "comic books", "a first-edition atlas"],
  toys: ["board games", "a remote-control car", "stuffed animals", "building blocks", "a dollhouse"],
  medicine: ["vitamins", "insulin pens", "prescription tablets", "first-aid kits", "asthma inhalers"],
  "auto parts": ["brake pads", "a car battery", "spark plugs", "a set of wiper blades", "an alternator"],
};

const CONTAINERS = ["A box", "A crate", "A padded envelope", "A carton", "A parcel", "A plastic tote"];

const SERVICE_WORDS: Record<ServiceLevel, string[]> = {
  express: ["express", "overnight", "next-day", "priority express"],
  standard: ["standard delivery", "regular shipping", "normal service"],
  economy: ["economy", "the cheapest option", "no rush, economy", "ground economy"],
};

const FRAGILE_WORDS = ["marked FRAGILE", "handle with care", "fragile stickers on every side", "labelled 'this side up, fragile'"];
const STURDY_WORDS = ["not fragile", "sturdy packaging", "", "", "no special handling"];

function weightText(rng: Rng, kg: number): string {
  if (kg < 1 && rng.chance(0.6)) return `${Math.round(kg * 1000)} g`;
  const r = rng.next();
  if (r < 0.2) return `${(kg * 2.20462).toFixed(1)} lb`;
  if (r < 0.35 && kg >= 3) return `about ${Math.round(kg)} kilos`;
  if (r < 0.5) return `${kg.toFixed(1)} kilograms`;
  return `${kg.toFixed(1)} kg`;
}

function valueText(rng: Rng, brl: number): string {
  const v = `R$ ${brl.toLocaleString("en-US")}`;
  return rng.pick([`declared value ${v}`, `insured for ${v}`, `worth ${v}`, `customs value ${v}`]);
}

/** Keep generated numbers away from the tree's thresholds, so wording never flips the answer. */
function awayFrom(rng: Rng, lo: number, hi: number, cuts: number[], log = false): number {
  for (let tries = 0; tries < 50; tries++) {
    const v = log ? Math.exp(rng.range(Math.log(lo), Math.log(hi))) : rng.range(lo, hi);
    if (cuts.every((c) => Math.abs(v - c) / c > 0.12)) return v;
  }
  return lo;
}

export interface LabelledParcel extends Parcel {
  id: string;
  label: string;
}

export function generateParcels(root: TreeNode, count: number, level: number, seed: number): LabelledParcel[] {
  const rng = new Rng(seed * 9173 + level * 13);
  const weightCuts = cutsUsed(root, "weight");
  const valueCuts = cutsUsed(root, "value");
  const parcels: LabelledParcel[] = [];

  for (let i = 0; i < count; i++) {
    const contents = rng.pick(CONTENTS);
    const region = rng.pick(REGIONS) as Region;
    const city = rng.pick(CITIES[region]);
    const service = rng.pick(SERVICES);
    const fragile = rng.chance(0.35);
    const weightKg = Math.round(awayFrom(rng, 0.2, 40, weightCuts, true) * 10) / 10;
    const valueBRL = Math.round(awayFrom(rng, 20, 6000, valueCuts, true) / 5) * 5;

    const item = rng.pick(ITEMS[contents]);
    const handling = fragile ? rng.pick(FRAGILE_WORDS) : rng.pick(STURDY_WORDS);
    const serviceText = rng.pick(SERVICE_WORDS[service]);
    const dest = rng.pick([`to ${city}`, `for a customer in ${city}`, `bound for ${city}`]);
    const parts = [`${rng.pick(CONTAINERS)} of ${item}`, weightText(rng, weightKg), handling, `${serviceText} ${dest}`, valueText(rng, valueBRL)].filter(Boolean);
    // Keep the item first; shuffle the rest a little.
    const [head, ...rest] = parts;
    rest.sort(() => rng.next() - 0.5);

    parcels.push({
      id: `P${String(i + 1).padStart(2, "0")}`,
      label: `${[head, ...rest].join(", ")}.`,
      weightKg,
      valueBRL,
      contents,
      city,
      region,
      service,
      fragile,
    });
  }
  return parcels;
}
