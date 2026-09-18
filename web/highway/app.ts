import type { ArenaFrame, ArenaLaneFrame, Mode } from "../../src/arena/protocol";
import type { HighwayView } from "../../src/games/highway/world";
import { cssVar, fitCanvas, runArena } from "../shared/arena";

type Lane = ArenaLaneFrame<HighwayView>;

const LANES = 5;
const AHEAD_M = 140;
const BEHIND_M = 30;
const LANE_ANIM_S = 0.15;

function palette() {
  return {
    asphalt: cssVar("--asphalt"),
    deep: cssVar("--asphalt-deep"),
    paint: cssVar("--paint"),
    yellow: cssVar("--paint-yellow"),
    barrier: cssVar("--barrier"),
    barrierWhite: cssVar("--barrier-white"),
    coin: cssVar("--coin"),
    sodium: cssVar("--sodium"),
    red: cssVar("--red"),
    muted: cssVar("--muted"),
  };
}
type Palette = ReturnType<typeof palette>;

function drawRoad(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, v: HighwayView, busyAgeS: number | null, p: Palette): void {
  const px = (n: number) => n * dpr;
  const carY = h * (AHEAD_M / (AHEAD_M + BEHIND_M));
  const k = carY / AHEAD_M;
  const Y = (s: number) => carY - (s - v.s) * k;
  const shoulder = w * 0.1;
  const laneW = (w - 2 * shoulder) / LANES;
  const laneX = (l: number) => shoulder + laneW * (l + 0.5);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = p.deep;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = p.asphalt;
  ctx.fillRect(shoulder, 0, w - 2 * shoulder, h);

  // Sodium lamps along both shoulders: faint warm pools reaching into the outer lanes.
  const lampEvery = 45;
  for (let s = Math.floor((v.s - BEHIND_M) / lampEvery) * lampEvery; s < v.s + AHEAD_M + lampEvery; s += lampEvery) {
    for (const side of [0, 1]) {
      const x = side ? w - shoulder * 0.5 : shoulder * 0.5;
      const y = Y(s + (side ? lampEvery / 2 : 0));
      const r = laneW * 1.4;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `${p.sodium}38`);
      g.addColorStop(1, `${p.sodium}00`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = p.sodium;
      ctx.fillRect(x - px(2), y - px(2), px(4), px(4));
    }
  }

  // Edge lines and lane dashes, scrolling with the car.
  ctx.lineWidth = px(2);
  ctx.strokeStyle = p.yellow;
  ctx.beginPath();
  ctx.moveTo(shoulder, 0);
  ctx.lineTo(shoulder, h);
  ctx.stroke();
  ctx.strokeStyle = p.paint;
  ctx.beginPath();
  ctx.moveTo(w - shoulder, 0);
  ctx.lineTo(w - shoulder, h);
  ctx.stroke();
  const dash = 6;
  ctx.lineWidth = px(1.5);
  ctx.strokeStyle = `${p.paint}aa`;
  for (let l = 1; l < LANES; l++) {
    const x = shoulder + laneW * l;
    for (let s = Math.floor((v.s - BEHIND_M) / (dash * 2)) * dash * 2; s < v.s + AHEAD_M; s += dash * 2) {
      ctx.beginPath();
      ctx.moveTo(x, Y(s));
      ctx.lineTo(x, Y(s + dash));
      ctx.stroke();
    }
  }

  // Distance markers on the left shoulder.
  ctx.fillStyle = p.muted;
  ctx.font = `${px(9)}px "B612", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let s = Math.ceil((v.s - BEHIND_M) / 100) * 100; s < v.s + AHEAD_M; s += 100) ctx.fillText(`${s}`, shoulder * 0.5, Y(s) - px(10));

  // Coins: small reflective diamonds, cool against the warm lamps.
  for (const c of v.coins) {
    if (c.taken) continue;
    const x = laneX(c.lane);
    const y = Y(c.s);
    const r = Math.max(px(4), laneW * 0.1);
    ctx.fillStyle = p.coin;
    ctx.strokeStyle = p.deep;
    ctx.lineWidth = px(1);
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.75, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.75, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Barriers: striped blocks across the blocked lanes.
  const bh = Math.max(px(7), 1.8 * k);
  for (const r of v.rows) {
    const y = Y(r.s);
    r.blocked.forEach((b, l) => {
      if (!b) return;
      const x0 = shoulder + laneW * l + laneW * 0.08;
      const bw = laneW * 0.84;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y - bh / 2, bw, bh);
      ctx.clip();
      ctx.fillStyle = r.hit === l ? p.red : p.barrier;
      ctx.fillRect(x0, y - bh / 2, bw, bh);
      ctx.strokeStyle = p.barrierWhite;
      ctx.lineWidth = bh * 0.35;
      for (let sx = x0 - bh; sx < x0 + bw + bh; sx += bh * 1.4) {
        ctx.beginPath();
        ctx.moveTo(sx, y + bh / 2);
        ctx.lineTo(sx + bh, y - bh / 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  // The car, sliding between lanes, with headlights.
  const tLane = Math.min(1, Math.max(0, (v.t - v.laneChangedAt) / LANE_ANIM_S));
  const carX = laneX(v.prevLane) + (laneX(v.lane) - laneX(v.prevLane)) * tLane;
  const carW = laneW * 0.46;
  const carH = Math.max(px(18), 4.5 * k);
  const beam = ctx.createLinearGradient(0, carY - carH / 2, 0, carY - carH / 2 - laneW * 2.6);
  beam.addColorStop(0, "rgba(255,240,200,0.22)");
  beam.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(carX - carW * 0.35, carY - carH / 2);
  ctx.lineTo(carX - laneW * 0.75, carY - carH / 2 - laneW * 2.6);
  ctx.lineTo(carX + laneW * 0.75, carY - carH / 2 - laneW * 2.6);
  ctx.lineTo(carX + carW * 0.35, carY - carH / 2);
  ctx.closePath();
  ctx.fill();

  // Signature: the ghost car, where the car was when the controller last looked.
  if (busyAgeS !== null && busyAgeS > 0.02) {
    const gy = carY + busyAgeS * v.speed * k;
    ctx.strokeStyle = p.paint;
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([px(3), px(3)]);
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(carX - carW / 2, gy - carH / 2, carW, carH);
    ctx.beginPath();
    ctx.moveTo(carX, gy - carH / 2);
    ctx.lineTo(carX, carY + carH / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.paint;
    ctx.font = `${px(9)}px "B612", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = `looked here · ${Math.round(busyAgeS * v.speed)} m ago`;
    const lx = carX + carW / 2 + px(6);
    ctx.fillText(label, Math.min(lx, w - ctx.measureText(label).width - px(4)), Math.min(gy, h - px(8)));
  }

  const crashed = v.crashes.some((c) => v.t - c < 0.6);
  ctx.fillStyle = crashed ? p.red : p.paint;
  ctx.fillRect(carX - carW / 2, carY - carH / 2, carW, carH);
  ctx.fillStyle = p.deep;
  ctx.fillRect(carX - carW * 0.35, carY - carH * 0.25, carW * 0.7, carH * 0.22);
  if (crashed) {
    ctx.strokeStyle = p.red;
    ctx.lineWidth = px(3);
    ctx.strokeRect(px(1.5), px(1.5), w - px(3), h - px(3));
  }

  // Progress along the route.
  const frac = v.s / v.length;
  ctx.fillStyle = `${p.paint}33`;
  ctx.fillRect(w - px(5), 0, px(3), h);
  ctx.fillStyle = p.paint;
  ctx.fillRect(w - px(5), h * (1 - frac), px(3), h * frac);
}

function mountRoad(container: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.className = "road";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Road ahead with barriers, coins and the car");
  container.append(canvas);
  const p = palette();
  const fit = fitCanvas(canvas);
  let lane: Lane | null = null;
  let mode: Mode = "realtime";
  return {
    update(l: Lane, frame: ArenaFrame<HighwayView>) {
      lane = l;
      mode = frame.config.mode;
    },
    draw() {
      if (!lane) return;
      const { w, h, dpr } = fit.size();
      drawRoad(fit.ctx, w, h, dpr, lane.view, mode === "realtime" && lane.busy ? lane.viewAgeS : null, p);
    },
  };
}

runArena<HighwayView>({
  gameId: "highway",
  subtitle: "Five lanes · one move per answer",
  intro: "Pick the controllers and press Start match. Every car drives the same road. Real time at 1× is real time: the road does not wait for an answer.",
  modeText: {
    realtime: "Real time: the road keeps moving while each controller thinks. The dashed ghost car shows where it was when the controller looked.",
    turn: "Turn based: the road stops for every answer. Only the choice counts.",
  },
  legend: [
    { svg: '<rect x="3" y="1" width="6" height="10" class="lg-car"/>', text: "Car" },
    { svg: '<rect x="3" y="1" width="6" height="10" class="lg-ghost"/>', text: "Ghost: where the car was when the controller looked" },
    { svg: '<rect x="1" y="4" width="10" height="4" class="lg-barrier"/>', text: "Barrier" },
    { svg: '<path d="M6 1 L10 6 L6 11 L2 6 Z" class="lg-coin"/>', text: "Coin" },
  ],
  board: [
    { label: "Crashes", value: (l) => String(l.metrics.crashes ?? 0), bad: (l) => (l.metrics.crashes ?? 0) > 0 },
    { label: "Coins", value: (l) => `${l.metrics.coins ?? 0}/${l.metrics.coinsTotal ?? 0}` },
    { label: "Moves", value: (l) => String(l.metrics.moves ?? 0) },
    { label: "Blind for", value: (l) => (l.metrics.decisions ? `${(l.metrics.meanStaleS ?? 0).toFixed(2)} s` : "–") },
    { label: "Route", value: (l) => `${Math.round((l.metrics.progress ?? 0) * 100)}%` },
    { label: "Score", value: (l) => String(l.score), score: true },
  ],
  stateLine(lane, mode) {
    if (lane.done) return "Arrived";
    if (lane.busy && mode === "realtime") return `Deciding · driving blind for ${Math.round(lane.viewAgeS * lane.view.speed)} m`;
    if (lane.busy) return "Deciding · the road is waiting";
    return "Driving";
  },
  mountBody: (container) => mountRoad(container),
});
