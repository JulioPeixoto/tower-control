// Riverton: a small fictional city. Plain data, shared by the simulator and the map renderer.
// Units: kilometres, origin at the south-west corner, y grows to the north.

export type Service = "fire" | "medical" | "police";
export const SERVICES: readonly Service[] = ["fire", "medical", "police"];

export interface District {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  streets: string[];
}

export const CITY_SIZE = 6;
export const BLOCK = 0.5;

export const DISTRICTS: District[] = [
  { name: "Harbor", x0: 0, y0: 0, x1: 2.5, y1: 2, streets: ["Dock Street", "Pier Road", "Anchor Lane", "Salt Street"] },
  { name: "Old Town", x0: 2.5, y0: 0, x1: 4, y1: 2.5, streets: ["Chapel Street", "Clock Square", "Mill Lane", "Lantern Row"] },
  { name: "Market", x0: 4, y0: 0, x1: 6, y1: 2.5, streets: ["Market Street", "Baker Lane", "Coin Street", "Spice Row"] },
  { name: "Riverside", x0: 0, y0: 2, x1: 2.5, y1: 4, streets: ["River Walk", "Willow Street", "Ferry Road", "Heron Lane"] },
  { name: "University", x0: 2.5, y0: 2.5, x1: 6, y1: 4, streets: ["College Avenue", "Library Lane", "Oak Street", "Campus Drive"] },
  { name: "Hillside", x0: 0, y0: 4, x1: 3, y1: 6, streets: ["Summit Road", "Vine Street", "Quarry Lane", "Terrace Hill"] },
  { name: "Airport Road", x0: 3, y0: 4, x1: 6, y1: 6, streets: ["Runway Avenue", "Hangar Street", "Cargo Lane", "Terminal Road"] },
];

export interface Station {
  service: Service;
  name: string;
  x: number;
  y: number;
  units: string[];
}

export const STATIONS: Station[] = [
  { service: "fire", name: "Fire station", x: 1.5, y: 3, units: ["F1", "F2"] },
  { service: "medical", name: "St. Clare Hospital", x: 4.5, y: 3, units: ["A1", "A2", "A3"] },
  { service: "police", name: "Police HQ", x: 3, y: 1, units: ["P1", "P2", "P3"] },
];

/** The river, for the map only: it does not block travel (there are bridges everywhere). */
export const RIVER: [number, number][] = [
  [0, 1.2],
  [0.9, 1.5],
  [1.6, 2.4],
  [2.1, 3.6],
  [2.9, 4.3],
  [4.2, 4.6],
  [6, 4.2],
];

export const SERVICE_LABEL: Record<Service, string> = { fire: "Fire", medical: "Ambulance", police: "Police" };
export const PRIORITY_LABEL = ["Low", "Urgent", "Critical"] as const;

export function districtAt(x: number, y: number): District {
  return DISTRICTS.find((d) => x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) ?? DISTRICTS[0]!;
}
