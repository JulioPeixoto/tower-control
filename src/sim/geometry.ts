// Airspace geometry. Units: nautical miles (x = east, y = north), feet, knots, seconds.
export type Runway = "09L" | "09R";
export const RUNWAYS: readonly Runway[] = ["09L", "09R"];

export interface Point {
  x: number;
  y: number;
}

export const ORIGIN: Point = { x: 0, y: 0 };

/** Both runways land eastbound (heading 090). The fix sits 8 nm west of each threshold. */
export const RUNWAY_GEOMETRY: Record<Runway, { threshold: Point; end: Point; fix: Point }> = {
  "09L": { threshold: { x: -1.2, y: 0.8 }, end: { x: 1.2, y: 0.8 }, fix: { x: -9.2, y: 0.8 } },
  "09R": { threshold: { x: -1.2, y: -0.8 }, end: { x: 1.2, y: -0.8 }, fix: { x: -9.2, y: -0.8 } },
};

export const FIX_DISTANCE = 8;
export const FIX_ALT = 3000;
export const FIX_MAX_ALT = 3500;
export const RADAR_RANGE = 34;
export const SPAWN_RADIUS = 31;
export const CLEARANCE_RANGE = 25;
export const SEP_NM = 3;
export const SEP_FINAL_NM = 2.5;
export const SEP_FT = 1000;
export const COLLISION_NM = 0.25;
export const COLLISION_FT = 300;
export const RUNWAY_OCCUPANCY_S = 50;

export const rad = (deg: number) => (deg * Math.PI) / 180;

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bearing in degrees from `from` to `to` (0 = north, 90 = east). */
export function bearing(from: Point, to: Point): number {
  return norm360((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI);
}

export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest turn from one heading to another, in (-180, 180]. */
export function turnDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function compass(deg: number): string {
  return COMPASS[Math.round(norm360(deg) / 45) % 8]!;
}

export function fmtClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
