// Renders the world as the text every model reads. Runway closures and emergencies appear
// only as radio text, so a controller has to read language to know about them.
// With `facts`, each aircraft also gets exact, code-computed facts (never advice): the
// community's chess tests found Jev goes from worse-than-random to ~950 Elo that way.
import { pad3 } from "./commands";
import { CLEARANCE_RANGE, FIX_MAX_ALT, ORIGIN, RADAR_RANGE, RUNWAYS, RUNWAY_GEOMETRY, SEP_FT, SEP_NM, bearing, compass, dist, fmtClock, rad } from "./geometry";
import type { Aircraft, RadioLine } from "./types";
import { MAYDAY_DEADLINE_S, MEDICAL_DEADLINE_S, type World } from "./world";

const RULES = `RULES
- Two parallel runways: 09L (north) and 09R (south). Both land eastbound, heading 090.
- Each runway has a final approach fix 8 nm west of its threshold. A landing clearance makes the aircraft fly direct to that fix, descend to 3000 ft, then fly the final approach and land by itself.
- An aircraft goes around if it reaches the fix above 3500 ft, if its runway is closed, or if the same runway had a landing less than 50 s earlier. Descend aircraft early.
- Landing clearances are refused beyond 25 nm from the airport.
- Separation: at least 3 nm horizontally or 1000 ft vertically (2.5 nm between aircraft on the same final). Aircraft on different finals are exempt.
- Aircraft that leave the 34 nm radar range while vectoring or holding are lost. Aircraft with no fuel crash.
- A mayday aircraft must land within ${MAYDAY_DEADLINE_S / 60} minutes. A medical emergency should land within ${MEDICAL_DEADLINE_S / 60} minutes.
- Goal: land everyone safely and quickly. A crash costs far more than a delay.`;

function status(a: Aircraft): string {
  switch (a.phase) {
    case "vectoring":
      return `vectoring, assigned heading ${pad3(a.tgtHdg)}`;
    case "holding":
      return "holding";
    case "approach":
      return `cleared to land ${a.runway}, ${dist(a, RUNWAY_GEOMETRY[a.runway!].fix).toFixed(1)} nm to the fix`;
    case "final":
      return `on final ${a.runway}, ${dist(a, RUNWAY_GEOMETRY[a.runway!].threshold).toFixed(1)} nm to touchdown`;
    default:
      return a.phase;
  }
}

function aircraftLine(a: Aircraft): string {
  const alt = Math.round(a.alt / 100) * 100;
  const altText = Math.abs(a.tgtAlt - a.alt) > 50 ? `${alt} ft -> ${a.tgtAlt} ft` : `${alt} ft`;
  const fixL = dist(a, RUNWAY_GEOMETRY["09L"].fix).toFixed(1);
  const fixR = dist(a, RUNWAY_GEOMETRY["09R"].fix).toFixed(1);
  return (
    `${a.id} "${a.telephony}" ${a.type}: ${dist(a, ORIGIN).toFixed(1)} nm ${compass(bearing(ORIGIN, a))} ` +
    `(x ${a.x.toFixed(1)}, y ${a.y.toFixed(1)}), heading ${pad3(a.hdg)}, ${altText}, ${Math.round(a.spd)} kt, ` +
    `fuel ${Math.floor(a.fuel)} min, ${status(a)}. To fix 09L ${fixL} nm, 09R ${fixR} nm.`
  );
}

const DESCENT_FPM = 2000;
const LOOKAHEAD_S = 120;

const velocity = (a: Aircraft) => ({ vx: (Math.sin(rad(a.hdg)) * a.spd) / 3600, vy: (Math.cos(rad(a.hdg)) * a.spd) / 3600 });

/** Seconds until a straight flight on the current heading leaves the scope, or null if it never does soon. */
function secondsToScopeEdge(a: Aircraft): number | null {
  const { vx, vy } = velocity(a);
  // Solve |p + v t| = R for t > 0.
  const A = vx * vx + vy * vy;
  const B = 2 * (a.x * vx + a.y * vy);
  const C = a.x * a.x + a.y * a.y - RADAR_RANGE * RADAR_RANGE;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return null;
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  return t > 0 ? t : null;
}

/** Straight-line closest approach within the look-ahead window. */
function predictedConflict(a: Aircraft, others: Aircraft[]): string | null {
  const va = velocity(a);
  let worst: { id: string; t: number; d: number } | null = null;
  for (const b of others) {
    if (b === a || b.phase === "final") continue;
    if (Math.abs(a.alt - b.alt) >= SEP_FT && Math.abs(a.tgtAlt - b.tgtAlt) >= SEP_FT) continue;
    const vb = velocity(b);
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const wx = vb.vx - va.vx;
    const wy = vb.vy - va.vy;
    const w2 = wx * wx + wy * wy;
    const t = w2 === 0 ? 0 : Math.max(0, Math.min(LOOKAHEAD_S, -(rx * wx + ry * wy) / w2));
    const d = Math.hypot(rx + wx * t, ry + wy * t);
    if (d < SEP_NM && (!worst || t < worst.t)) worst = { id: b.id, t, d };
  }
  return worst ? `on present headings it comes within ${worst.d.toFixed(1)} nm of ${worst.id} in ${Math.round(worst.t)} s` : null;
}

function factsFor(a: Aircraft, all: Aircraft[]): string[] {
  const facts: string[] = [];
  const d = dist(a, ORIGIN);
  facts.push(`direct heading to the airport ${pad3(bearing(a, ORIGIN))}`);
  if (a.phase === "vectoring" || a.phase === "holding") {
    facts.push(d <= CLEARANCE_RANGE ? "close enough to be cleared to land" : `too far to be cleared to land (${d.toFixed(1)} nm, limit ${CLEARANCE_RANGE})`);
    const nearestFix = Math.min(...RUNWAYS.map((r) => dist(a, RUNWAY_GEOMETRY[r].fix)));
    const minutesToFix = nearestFix / (a.spd / 60);
    const minutesToDescend = Math.max(0, a.alt - FIX_MAX_ALT) / DESCENT_FPM;
    facts.push(
      minutesToDescend <= minutesToFix
        ? "low enough to reach the fix below 3500 ft if cleared now"
        : `too high to reach the fix below 3500 ft if cleared now (needs ${minutesToDescend.toFixed(1)} min to descend, fix is ${minutesToFix.toFixed(1)} min away)`,
    );
    const edge = a.phase === "vectoring" ? secondsToScopeEdge(a) : null;
    if (edge !== null && edge < 300) facts.push(`leaves the radar in ${Math.round(edge)} s on this heading`);
  }
  const conflict = predictedConflict(a, all);
  if (conflict) facts.push(conflict);
  return facts;
}

function radioLine(l: RadioLine): string {
  const who = l.to ? `${l.from} -> ${l.to}` : l.from;
  return `[${fmtClock(l.t)}] ${who}: ${l.kind === "call" || l.kind === "emergency" || l.kind === "notice" ? `"${l.text}"` : l.text}`;
}

export function describeState(w: World, { facts = false }: { facts?: boolean } = {}): string {
  const air = w.airborne().sort((a, b) => dist(a, ORIGIN) - dist(b, ORIGIN));
  const out: string[] = [`Approach control. Time ${fmtClock(w.t)}.`, "", RULES, "", "RUNWAYS"];

  for (const r of RUNWAYS) {
    const last = w.lastLandingAt(r);
    out.push(`- ${r}: ${Number.isFinite(last) ? `last landing ${Math.round(w.t - last)} s ago` : "no landings yet"}`);
  }

  out.push("", "TRAFFIC (x = nm east, y = nm north of the airport)");
  if (!air.length) out.push("- none");
  for (const a of air) {
    out.push(`- ${aircraftLine(a)}`);
    if (facts) out.push(`  Facts: ${factsFor(a, air).join("; ")}.`);
  }

  out.push("", "CLOSE PAIRS (within 6 nm and 2000 ft)");
  const pairs: string[] = [];
  for (let i = 0; i < air.length; i++) {
    for (let j = i + 1; j < air.length; j++) {
      const a = air[i]!;
      const b = air[j]!;
      const dh = dist(a, b);
      const dv = Math.abs(a.alt - b.alt);
      if (dh < 6 && dv < 2000) pairs.push(`- ${a.id} / ${b.id}: ${dh.toFixed(1)} nm, ${Math.round(dv / 100) * 100} ft apart`);
    }
  }
  out.push(...(pairs.length ? pairs : ["- none"]));

  const notices = w.noticeLines();
  out.push("", "NOTICES", ...(notices.length ? notices.map((l) => `- ${radioLine(l)}`) : ["- none"]));

  const calls = w.pinnedLines();
  out.push("", "OPEN EMERGENCY CALLS", ...(calls.length ? calls.map((l) => `- ${radioLine(l)}`) : ["- none"]));

  const recent = w.radio.slice(-10);
  out.push("", "RECENT RADIO (oldest first)", ...(recent.length ? recent.map((l) => `- ${radioLine(l)}`) : ["- none"]));

  return out.join("\n");
}
