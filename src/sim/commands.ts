export const ACTIONS = ["continue", "vector", "hold", "land_09L", "land_09R"] as const;
export type Action = (typeof ACTIONS)[number];

export const HEADINGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as const;
export const ALTITUDES = [2000, 3000, 4000, 5000, 6000, 8000, 10000] as const;
export const SPEEDS = [180, 220, 250] as const;

export const pad3 = (n: number) => String(Math.round(n) % 360).padStart(3, "0");
