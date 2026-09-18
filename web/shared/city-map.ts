// The Riverton map, shared by City Dispatch and Street Patrol: blocks, river, districts,
// stations, incidents coloured by priority, and units as ink chips moving along the streets.
import { BLOCK, CITY_SIZE, DISTRICTS, RIVER } from "../../src/games/dispatch/city";
import { cssVar } from "./arena";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function cityPalette() {
  return {
    land: cssVar("--city-land"),
    block: cssVar("--city-block"),
    street: cssVar("--city-street"),
    water: cssVar("--city-water"),
    ink: cssVar("--city-ink"),
    inkSoft: cssVar("--city-ink-soft"),
    prio: [cssVar("--prio-low"), cssVar("--prio-urgent"), cssVar("--prio-critical")],
    paper: cssVar("--paper"),
    label: cssVar("--label"),
    muted: cssVar("--muted"),
    mapFaint: cssVar("--map-faint"),
    cyan: cssVar("--cyan"),
    red: cssVar("--red"),
  };
}
export type CityPalette = ReturnType<typeof cityPalette>;

export interface CityMapView {
  units: { id: string; x: number; y: number; status: string }[];
  incidents: {
    x: number;
    y: number;
    status: string;
    priority?: number;
    verdict?: "good" | "bad";
    unitX?: number;
    unitY?: number;
  }[];
}

export interface MapStation {
  x: number;
  y: number;
  letter: string;
}

export function drawCity(ctx: CanvasRenderingContext2D, size: number, dpr: number, view: CityMapView, stations: MapStation[], p: CityPalette, now: number): void {
  const k = size / CITY_SIZE;
  const X = (x: number) => x * k;
  const Y = (y: number) => size - y * k;
  const px = (n: number) => n * dpr;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = p.land;
  ctx.fillRect(0, 0, size, size);

  // Blocks between the streets.
  ctx.fillStyle = p.block;
  const gap = px(3);
  for (let x = 0; x < CITY_SIZE; x += BLOCK) {
    for (let y = 0; y < CITY_SIZE; y += BLOCK) ctx.fillRect(X(x) + gap / 2, Y(y + BLOCK) + gap / 2, BLOCK * k - gap, BLOCK * k - gap);
  }

  // River.
  ctx.strokeStyle = p.water;
  ctx.lineWidth = px(9);
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.beginPath();
  RIVER.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.stroke();

  // District borders and names.
  ctx.strokeStyle = p.inkSoft;
  ctx.lineWidth = px(1);
  ctx.setLineDash([px(4), px(4)]);
  ctx.font = `700 ${px(9)}px "B612", sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (const d of DISTRICTS) {
    ctx.strokeRect(X(d.x0), Y(d.y1), (d.x1 - d.x0) * k, (d.y1 - d.y0) * k);
    ctx.fillStyle = p.inkSoft;
    ctx.fillText(d.name.toUpperCase(), X(d.x0) + px(5), Y(d.y1) + px(5));
  }
  ctx.setLineDash([]);

  // Stations.
  for (const s of stations) {
    const sx = X(s.x);
    const sy = Y(s.y);
    ctx.fillStyle = p.ink;
    ctx.fillRect(sx - px(7), sy - px(7), px(14), px(14));
    ctx.fillStyle = p.land;
    ctx.font = `700 ${px(9)}px "B612 Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.letter, sx, sy + px(0.5));
  }

  // Incidents: a pulsing "?" while ringing, then a dot sized and coloured by priority.
  const pulse = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(now / 160);
  for (const inc of view.incidents) {
    const ix = X(inc.x);
    const iy = Y(inc.y);
    if (inc.status === "ringing") {
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(3), px(2)]);
      ctx.beginPath();
      ctx.arc(ix, iy, px(9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.ink;
      ctx.font = `700 ${px(10)}px "B612", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", ix, iy + px(0.5));
      continue;
    }
    const color = p.prio[Math.round(inc.priority ?? 1)] ?? p.prio[1]!;
    if (inc.status === "enroute" && inc.unitX !== undefined && inc.unitY !== undefined) {
      ctx.strokeStyle = color;
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(4), px(3)]);
      ctx.beginPath();
      ctx.moveTo(X(inc.unitX), Y(inc.unitY));
      ctx.lineTo(X(inc.unitX), iy);
      ctx.lineTo(ix, iy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const closed = inc.verdict !== undefined && inc.status !== "onscene";
    ctx.globalAlpha = closed ? 0.55 : 1;
    const r = px(5 + (inc.priority ?? 1) * 2);
    if (inc.status === "declined" || inc.status === "missed") {
      ctx.strokeStyle = inc.status === "missed" ? p.prio[2]! : p.inkSoft;
      ctx.lineWidth = px(1.5);
      ctx.beginPath();
      ctx.arc(ix, iy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ix, iy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (inc.verdict) {
      ctx.strokeStyle = inc.verdict === "good" ? p.ink : p.prio[2]!;
      ctx.lineWidth = px(2);
      ctx.beginPath();
      if (inc.verdict === "good") {
        ctx.moveTo(ix - px(4), iy);
        ctx.lineTo(ix - px(1), iy + px(3));
        ctx.lineTo(ix + px(4), iy - px(3));
      } else {
        ctx.moveTo(ix - px(3.5), iy - px(3.5));
        ctx.lineTo(ix + px(3.5), iy + px(3.5));
        ctx.moveTo(ix + px(3.5), iy - px(3.5));
        ctx.lineTo(ix - px(3.5), iy + px(3.5));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Units: ink chips with their call sign. Idle units line up beside their station.
  const idleIndex = new Map<string, number>();
  ctx.font = `700 ${px(9)}px "B612 Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const u of view.units) {
    let ux = X(u.x);
    const uy = Y(u.y);
    if (u.status === "idle") {
      const key = `${u.x},${u.y}`;
      const i = idleIndex.get(key) ?? 0;
      idleIndex.set(key, i + 1);
      ux += px(20) + i * px(24);
    }
    ctx.fillStyle = u.status === "idle" ? p.inkSoft : p.ink;
    ctx.fillRect(ux - px(10), uy - px(6.5), px(20), px(13));
    ctx.fillStyle = p.land;
    ctx.fillText(u.id, ux, uy + px(0.5));
  }
}
