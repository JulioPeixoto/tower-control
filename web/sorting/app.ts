import type { ArenaFrame, ArenaLaneFrame } from "../../src/arena/protocol";
import { SORTING_LEVELS, buildTree, splitName, type TreeNode } from "../../src/games/sorting/tree";
import type { SortingView } from "../../src/games/sorting/world";
import { cssVar, fitCanvas, runArena } from "../shared/arena";

type Lane = ArenaLaneFrame<SortingView>;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function palette() {
  return {
    floor: cssVar("--hub-floor"),
    belt: cssVar("--hub-belt"),
    tube: cssVar("--hub-tube"),
    tubeHot: cssVar("--hub-tube-hot"),
    kraft: cssVar("--hub-kraft"),
    kraftEdge: cssVar("--hub-kraft-edge"),
    safety: cssVar("--hub-safety"),
    good: cssVar("--hub-good"),
    bad: cssVar("--red"),
    label: cssVar("--hub-label"),
    muted: cssVar("--muted"),
  };
}
type Palette = ReturnType<typeof palette>;

interface Layout {
  key: string;
  pos: Map<string, { x: number; y: number }>;
  nodes: TreeNode[];
  bays: TreeNode[];
  intakeY: number;
}

/** Leaves spread evenly along the bottom; each junction sits over the middle of its children. */
function layout(level: number, seed: number, w: number, h: number, dpr: number): Layout {
  const { root, bays, nodes } = buildTree(level, seed);
  const depth = (SORTING_LEVELS[level] ?? SORTING_LEVELS[3]!).depth;
  const padX = 18 * dpr;
  const top = 58 * dpr;
  const bottom = h - 26 * dpr;
  const pos = new Map<string, { x: number; y: number }>();
  const span = (w - 2 * padX) / Math.max(1, bays.length - 1);
  bays.forEach((b, i) => pos.set(b.id, { x: bays.length === 1 ? w / 2 : padX + i * span, y: bottom }));
  const place = (n: TreeNode): { x: number; y: number } => {
    if (!n.split) return pos.get(n.id)!;
    const kids = n.children.map(place);
    const p = { x: kids.reduce((s, k) => s + k.x, 0) / kids.length, y: top + (n.depth / depth) * (bottom - top) };
    pos.set(n.id, p);
    return p;
  };
  place(root);
  return { key: `${level}:${seed}:${w}:${h}`, pos, nodes: [...nodes.values()], bays, intakeY: 24 * dpr };
}

function drawHub(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, L: Layout, view: SortingView, t: number, p: Palette, now: number): void {
  const px = (n: number) => n * dpr;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = p.floor;
  ctx.fillRect(0, 0, w, h);

  const root = L.pos.get("J1")!;
  const dense = L.bays.length > 60;

  // Intake belt across the top, feeding the root.
  ctx.fillStyle = p.belt;
  ctx.fillRect(px(8), L.intakeY - px(9), root.x - px(8), px(18));
  ctx.fillStyle = p.muted;
  ctx.font = `700 ${px(9)}px "B612", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`INTAKE ${view.queue.length}/8`, px(14), L.intakeY + px(0.5));
  view.queue.slice(0, 8).forEach((_, i) => {
    const x = root.x - px(16) - i * px(16);
    ctx.fillStyle = p.kraft;
    ctx.fillRect(x - px(6), L.intakeY - px(6), px(12), px(12));
    ctx.strokeStyle = p.kraftEdge;
    ctx.lineWidth = px(1);
    ctx.strokeRect(x - px(6), L.intakeY - px(6), px(12), px(12));
  });
  ctx.strokeStyle = p.tube;
  ctx.lineWidth = px(3);
  ctx.beginPath();
  ctx.moveTo(root.x, L.intakeY);
  ctx.lineTo(root.x, root.y);
  ctx.stroke();

  // Tubes.
  for (const n of L.nodes) {
    if (!n.split) continue;
    const a = L.pos.get(n.id)!;
    ctx.lineWidth = px(Math.max(0.6, (dense ? 2.2 : 3) - n.depth * 0.7));
    ctx.strokeStyle = p.tube;
    for (const c of n.children) {
      const b = L.pos.get(c.id)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Junctions, with what they sort by near the top of the tree.
  for (const n of L.nodes) {
    if (!n.split) continue;
    const a = L.pos.get(n.id)!;
    ctx.fillStyle = p.floor;
    ctx.strokeStyle = p.tubeHot;
    ctx.lineWidth = px(1.5);
    ctx.beginPath();
    ctx.arc(a.x, a.y, px(n.depth === 0 ? 7 : dense ? 3 : 5), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (n.depth <= (dense ? 0 : 1)) {
      ctx.fillStyle = p.label;
      ctx.font = `${px(9.5)}px "B612", sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${n.id} · ${splitName(n.split)}`, a.x + px(10), a.y - px(1));
    }
  }

  // Bays along the floor. Recent deliveries light up: green right, red wrong (with a
  // green outline where it should have gone).
  const bayW = Math.max(px(1.2), Math.min(px(10), ((w - px(36)) / L.bays.length) * 0.7));
  for (const b of L.bays) {
    const q = L.pos.get(b.id)!;
    ctx.fillStyle = p.belt;
    ctx.fillRect(q.x - bayW / 2, q.y, bayW, px(8));
  }
  for (const d of view.deliveries) {
    const age = t - d.t;
    if (age > 25) continue;
    const alpha = Math.max(0.15, 1 - age / 25);
    const at = L.pos.get(d.bay);
    if (!at) continue;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.correct ? p.good : p.bad;
    ctx.fillRect(at.x - bayW / 2, at.y - px(2), bayW, px(14));
    if (!d.correct) {
      const right = L.pos.get(d.trueBay);
      if (right) {
        ctx.strokeStyle = p.good;
        ctx.lineWidth = px(1.5);
        ctx.strokeRect(right.x - bayW / 2 - px(1), right.y - px(3), bayW + px(2), px(16));
      }
    }
    ctx.globalAlpha = 1;
  }
  if (!dense) {
    ctx.fillStyle = p.muted;
    ctx.font = `${px(8)}px "B612 Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const b of L.bays) {
      const q = L.pos.get(b.id)!;
      ctx.fillText(b.id.slice(1), q.x, q.y + px(11));
    }
  } else {
    ctx.fillStyle = p.muted;
    ctx.font = `${px(9)}px "B612", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${L.bays.length} bays`, w - px(10), h - px(14));
  }

  // Parcels: sliding down tubes, or waiting at a junction for a decision (yellow).
  const blink = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(now / 140);
  for (const parcel of view.parcels) {
    const a = L.pos.get(parcel.from);
    if (!a) continue;
    const b = parcel.to ? L.pos.get(parcel.to) : undefined;
    const x = b ? a.x + (b.x - a.x) * parcel.progress : a.x;
    const y = b ? a.y + (b.y - a.y) * parcel.progress : a.y;
    ctx.fillStyle = p.kraft;
    ctx.fillRect(x - px(5), y - px(5), px(10), px(10));
    ctx.lineWidth = px(parcel.status === "waiting" ? 2 : 1);
    ctx.strokeStyle = parcel.status === "waiting" ? p.safety : p.kraftEdge;
    ctx.globalAlpha = parcel.status === "waiting" ? blink : 1;
    ctx.strokeRect(x - px(5), y - px(5), px(10), px(10));
    ctx.globalAlpha = 1;
  }
}

const pct = (v: number | undefined) => (v === undefined ? "–" : `${Math.round(v * 100)}%`);

runArena<SortingView>({
  gameId: "sorting",
  subtitle: "Parcels · decision tree",
  intro:
    "Pick a strategy and the controllers, then press Start match. Extract: one call reads the label and code walks the tree. Step by step: one choice per junction. Flat: one choice among every bay.",
  modeText: {
    realtime: "Real time: parcels keep arriving while each controller reads. A slow reader fills the intake belt and parcels get dropped.",
    turn: "Turn based: the belt waits for every answer. Only routing accuracy counts.",
  },
  legend: [
    { svg: '<rect x="2" y="2" width="8" height="8" class="lg-parcel"/>', text: "Parcel moving" },
    { svg: '<rect x="2" y="2" width="8" height="8" class="lg-waiting"/>', text: "Waiting at a junction for a decision" },
    { svg: '<rect x="4" y="1" width="4" height="10" class="lg-good"/>', text: "Delivered to the right bay" },
    { svg: '<rect x="4" y="1" width="4" height="10" class="lg-bad"/>', text: "Wrong bay (outlined: where it belonged)" },
  ],
  board: [
    { label: "Correct", value: (l) => `${l.metrics.correct ?? 0}/${l.metrics.delivered ?? 0}` },
    { label: "Wrong", value: (l) => String(l.metrics.wrong ?? 0), bad: (l) => (l.metrics.wrong ?? 0) > 0 },
    { label: "Dropped", value: (l) => String((l.metrics.dropped ?? 0) + (l.metrics.rejected ?? 0)), bad: (l) => (l.metrics.dropped ?? 0) + (l.metrics.rejected ?? 0) > 0 },
    { label: "Accuracy", value: (l) => (l.metrics.delivered ? pct(l.metrics.accuracy) : "–") },
    { label: "Per minute", value: (l) => (l.metrics.delivered ? (l.metrics.perMinute ?? 0).toFixed(1) : "–") },
    { label: "Score", value: (l) => String(l.score), score: true },
  ],
  stateLine(lane, mode) {
    if (lane.done) return "Shift over";
    const q = lane.view.queue.length;
    const belt = q ? ` · ${q} on the intake` : "";
    if (lane.busy) return mode === "realtime" ? `Reading a label · picture ${lane.viewAgeS.toFixed(1)} s old${belt}` : `Reading a label · the belt is waiting${belt}`;
    return q ? `${q} parcels on the intake` : "Belt clear";
  },
  mountBody(container) {
    const card = document.createElement("p");
    card.className = "label-card";
    const id = document.createElement("b");
    id.textContent = "—";
    const text = document.createElement("span");
    text.textContent = "The label of the parcel being read appears here.";
    card.append(id, text);
    const canvas = document.createElement("canvas");
    canvas.className = "hub-stage";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Sorting tree with parcels and bays");
    container.append(card, canvas);

    const p = palette();
    const fit = fitCanvas(canvas);
    let view: SortingView | null = null;
    let cfg: { level: number; seed: number } | null = null;
    let t = 0;
    let L: Layout | null = null;

    return {
      update(lane: Lane, frame: ArenaFrame<SortingView>) {
        view = lane.view;
        t = frame.t;
        cfg = { level: frame.config.level, seed: frame.config.seed };
        if (lane.view.lastLabel) {
          id.textContent = lane.view.lastLabel.id;
          text.textContent = lane.view.lastLabel.label;
        }
      },
      draw(now) {
        if (!view || !cfg) return;
        const { w, h, dpr } = fit.size();
        const key = `${cfg.level}:${cfg.seed}:${w}:${h}`;
        if (!L || L.key !== key) L = layout(cfg.level, cfg.seed, w, h, dpr);
        drawHub(fit.ctx, w, h, dpr, L, view, t, p, now);
      },
    };
  },
});
