import type { LaneFrame } from "../../src/protocol";
import { RADAR_RANGE, RUNWAYS, RUNWAY_GEOMETRY, SEP_NM, rad } from "../../src/sim/geometry";
import type { AircraftView } from "../../src/sim/types";

export interface Palette {
  console2: string;
  scope: string;
  map: string;
  mapFaint: string;
  label: string;
  muted: string;
  amber: string;
  red: string;
  cyan: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    console2: v("--console-2"),
    scope: v("--scope"),
    map: v("--map"),
    mapFaint: v("--map-faint"),
    label: v("--label"),
    muted: v("--muted"),
    amber: v("--amber"),
    red: v("--red"),
    cyan: v("--cyan"),
  };
}

export interface DrawOptions {
  size: number;
  dpr: number;
  palette: Palette;
  now: number;
  reducedMotion: boolean;
  showGhosts: boolean;
}

const fl = (ft: number) => String(Math.round(ft / 100)).padStart(3, "0");

function colorFor(a: AircraftView, p: Palette): string {
  if (a.emergency) return p.red;
  if (a.phase === "approach" || a.phase === "final") return p.cyan;
  if (a.phase === "holding") return p.muted;
  return p.label;
}

function tagFor(a: AircraftView): { text: string; tone: "red" | "amber" | "plain" } | null {
  if (a.emergency === "mayday") return { text: "MAYDAY", tone: "red" };
  if (a.emergency === "medical") return { text: "MEDICAL", tone: "red" };
  if (a.emergency === "fuel") return { text: `FUEL ${Math.floor(a.fuel)}`, tone: "red" };
  if (a.fuel < 6) return { text: `FUEL ${Math.floor(a.fuel)}`, tone: "amber" };
  if (a.phase === "approach") return { text: `ILS ${a.runway}`, tone: "plain" };
  if (a.phase === "final") return { text: `FINAL ${a.runway}`, tone: "plain" };
  if (a.phase === "holding") return { text: "HOLD", tone: "plain" };
  return null;
}

export function drawRadar(ctx: CanvasRenderingContext2D, lane: LaneFrame, o: DrawOptions): void {
  const { size, dpr, palette: p } = o;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 2 * dpr;
  const k = R / RADAR_RANGE;
  const X = (x: number) => cx + x * k;
  const Y = (y: number) => cy - y * k;
  const px = (n: number) => n * dpr;
  const world = lane.world;
  const closed = new Set(world.closed);

  ctx.clearRect(0, 0, size, size);

  // Scope disc, range rings and bearing ticks.
  ctx.fillStyle = p.scope;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = px(1);
  ctx.strokeStyle = p.mapFaint;
  ctx.setLineDash([px(2), px(5)]);
  for (const r of [10, 20, 30]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = p.map;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  for (let b = 0; b < 360; b += 10) {
    const len = px(b % 30 === 0 ? 9 : 4);
    const s = Math.sin(rad(b));
    const c = Math.cos(rad(b));
    ctx.beginPath();
    ctx.moveTo(cx + s * R, cy - c * R);
    ctx.lineTo(cx + s * (R - len), cy - c * (R - len));
    ctx.stroke();
  }

  ctx.font = `${px(10)}px "B612 Mono", monospace`;
  ctx.fillStyle = p.map;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  for (const r of [10, 20, 30]) ctx.fillText(`${r}`, cx + px(4), cy - r * k - px(2));

  // Final approach courses, fixes and runways.
  for (const rwy of RUNWAYS) {
    const g = RUNWAY_GEOMETRY[rwy];
    ctx.strokeStyle = p.map;
    ctx.lineWidth = px(1);
    ctx.setLineDash([px(5), px(5)]);
    ctx.beginPath();
    ctx.moveTo(X(g.fix.x - 5), Y(g.fix.y));
    ctx.lineTo(X(g.threshold.x), Y(g.threshold.y));
    ctx.stroke();
    ctx.setLineDash([]);

    const fx = X(g.fix.x);
    const fy = Y(g.fix.y);
    ctx.beginPath();
    ctx.moveTo(fx, fy - px(4));
    ctx.lineTo(fx + px(4), fy + px(3));
    ctx.lineTo(fx - px(4), fy + px(3));
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = closed.has(rwy) ? p.red : p.label;
    ctx.lineWidth = px(4);
    ctx.beginPath();
    ctx.moveTo(X(g.threshold.x), Y(g.threshold.y));
    ctx.lineTo(X(g.end.x), Y(g.end.y));
    ctx.stroke();

    ctx.fillStyle = closed.has(rwy) ? p.red : p.muted;
    ctx.font = `${px(9)}px "B612 Mono", monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = rwy === "09L" ? "bottom" : "top";
    const ly = Y(g.end.y) + (rwy === "09L" ? -px(4) : px(4));
    ctx.fillText(closed.has(rwy) ? `${rwy} CLOSED` : rwy, X(g.end.x) + px(4), ly);
  }

  const byId = new Map(world.aircraft.map((a) => [a.id, a]));

  // Signature: ghosts. Where each aircraft was when the controller started deciding.
  if (o.showGhosts && lane.busy) {
    ctx.strokeStyle = p.label;
    ctx.lineWidth = px(1);
    for (const g of lane.ghosts) {
      const a = byId.get(g.id);
      if (!a) continue;
      const gx = X(g.x);
      const gy = Y(g.y);
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([px(2), px(3)]);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(X(a.x), Y(a.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(gx, gy - px(4));
      ctx.lineTo(gx + px(4), gy);
      ctx.lineTo(gx, gy + px(4));
      ctx.lineTo(gx - px(4), gy);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Separation losses: a ring of half the minimum around each aircraft, so rings touch at the limit.
  const pulse = o.reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(o.now / 180);
  ctx.strokeStyle = p.amber;
  ctx.lineWidth = px(1.5);
  for (const [ia, ib] of world.conflicts) {
    const a = byId.get(ia);
    const b = byId.get(ib);
    if (!a || !b) continue;
    ctx.globalAlpha = pulse;
    for (const c of [a, b]) {
      ctx.beginPath();
      ctx.arc(X(c.x), Y(c.y), (SEP_NM / 2) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y));
    ctx.lineTo(X(b.x), Y(b.y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Aircraft: history dots, speed vector, symbol, leader line and data block.
  for (const a of world.aircraft) {
    const color = colorFor(a, p);
    const ax = X(a.x);
    const ay = Y(a.y);

    ctx.fillStyle = color;
    a.trail.forEach(([tx, ty], i) => {
      ctx.globalAlpha = 0.12 + (0.45 * (i + 1)) / a.trail.length;
      ctx.beginPath();
      ctx.arc(X(tx), Y(ty), px(1.3), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    const vec = a.spd / 60;
    ctx.strokeStyle = color;
    ctx.lineWidth = px(1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(X(a.x + Math.sin(rad(a.hdg)) * vec), Y(a.y + Math.cos(rad(a.hdg)) * vec));
    ctx.stroke();

    const s = px(3.5);
    ctx.lineWidth = px(1.4);
    if (a.phase === "approach" || a.phase === "final" || a.emergency) ctx.fillRect(ax - s, ay - s, s * 2, s * 2);
    else ctx.strokeRect(ax - s, ay - s, s * 2, s * 2);

    const trend = a.tgtAlt < a.alt - 60 ? "↓" : a.tgtAlt > a.alt + 60 ? "↑" : " ";
    const altBlock = trend === " " ? fl(a.alt) : `${fl(a.alt)}${trend}${fl(a.tgtAlt)}`;
    const line2 = `${altBlock} ${Math.round(a.spd / 10)}`;
    const tag = tagFor(a);
    const bold = `700 ${px(11)}px "B612 Mono", monospace`;
    const regular = `${px(10.5)}px "B612 Mono", monospace`;
    ctx.font = regular;
    const blockWidth = Math.max(ctx.measureText(line2).width, tag ? ctx.measureText(tag.text).width : 0, a.id.length * px(7));

    // Data block sits up-right of the symbol, or up-left near the scope's right edge.
    const flip = ax + px(12) + blockWidth > size - px(4);
    const lx = flip ? ax - px(12) - blockWidth : ax + px(12);
    const ly = ay - px(12);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(flip ? ax - s : ax + s, ay - s);
    ctx.lineTo(flip ? lx + blockWidth + px(2) : lx - px(2), ly + px(2));
    ctx.stroke();
    ctx.globalAlpha = 1;

    const lh = px(12);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = bold;
    ctx.fillStyle = color;
    ctx.fillText(a.id, lx, ly - lh);
    ctx.font = regular;
    ctx.fillText(line2, lx, ly);
    if (tag) {
      ctx.fillStyle = tag.tone === "red" ? p.red : tag.tone === "amber" ? p.amber : color;
      ctx.fillText(tag.text, lx, ly + lh);
    }
  }
}
