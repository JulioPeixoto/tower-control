import type { ArenaLaneFrame } from "../../src/arena/protocol";
import { BLOCK, CITY_SIZE, DISTRICTS, PRIORITY_LABEL, RIVER, SERVICE_LABEL, STATIONS } from "../../src/games/dispatch/city";
import type { DispatchCard, DispatchView } from "../../src/games/dispatch/world";
import { fmtClock } from "../../src/sim/geometry";
import { cssVar, fitCanvas, runArena } from "../shared/arena";

type Lane = ArenaLaneFrame<DispatchView>;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function palette() {
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
type Palette = ReturnType<typeof palette>;

// --- city map ---------------------------------------------------------------------------

function drawCity(ctx: CanvasRenderingContext2D, size: number, dpr: number, view: DispatchView, p: Palette, now: number): void {
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
  for (const s of STATIONS) {
    const sx = X(s.x);
    const sy = Y(s.y);
    ctx.fillStyle = p.ink;
    ctx.fillRect(sx - px(7), sy - px(7), px(14), px(14));
    ctx.fillStyle = p.land;
    ctx.font = `700 ${px(9)}px "B612 Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.service === "fire" ? "F" : s.service === "medical" ? "H" : "P", sx, sy + px(0.5));
  }

  // Incidents.
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
    const color = p.prio[inc.priority ?? 1]!;
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
    let uy = Y(u.y);
    if (u.status === "idle") {
      const i = idleIndex.get(u.service) ?? 0;
      idleIndex.set(u.service, i + 1);
      ux += px(20) + i * px(24);
    }
    ctx.fillStyle = u.status === "idle" ? p.inkSoft : p.ink;
    ctx.fillRect(ux - px(10), uy - px(6.5), px(20), px(13));
    ctx.fillStyle = p.land;
    ctx.fillText(u.id, ux, uy + px(0.5));
  }
}

// --- reliability diagram -------------------------------------------------------------------

function drawCalibration(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, rel: DispatchView["reliability"], p: Palette): void {
  const px = (n: number) => n * dpr;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: px(26), r: px(6), t: px(6), b: px(16) };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const X = (v: number) => pad.l + v * cw;
  const Y = (v: number) => pad.t + (1 - v) * ch;

  ctx.strokeStyle = p.mapFaint;
  ctx.lineWidth = px(1);
  ctx.strokeRect(X(0), Y(1), cw, ch);
  ctx.setLineDash([px(3), px(3)]);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  ctx.lineTo(X(1), Y(1));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = p.muted;
  ctx.font = `${px(9)}px "B612", sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("real", X(0) - px(4), Y(1) + px(4));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("0", X(0), Y(0) + px(3));
  ctx.fillText("predicted chance a unit is needed", X(0.5), Y(0) + px(3));
  ctx.fillText("1", X(1), Y(0) + px(3));

  const bins = rel.n.length;
  const maxN = Math.max(1, ...rel.n);
  // How many answers fell in each bin, as faint columns.
  for (let i = 0; i < bins; i++) {
    const n = rel.n[i]!;
    if (!n) continue;
    ctx.fillStyle = p.mapFaint;
    const bh = (n / maxN) * ch * 0.35;
    ctx.fillRect(X(i / bins) + px(1), Y(0) - bh, cw / bins - px(2), bh);
  }
  // Observed rate per bin: on the diagonal means calibrated.
  ctx.strokeStyle = p.paper;
  ctx.fillStyle = p.paper;
  ctx.lineWidth = px(1.5);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < bins; i++) {
    const n = rel.n[i]!;
    if (!n) continue;
    const x = X((i + 0.5) / bins);
    const y = Y(rel.yes[i]! / n);
    if (started) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    started = true;
  }
  ctx.stroke();
  for (let i = 0; i < bins; i++) {
    const n = rel.n[i]!;
    if (!n) continue;
    ctx.beginPath();
    ctx.arc(X((i + 0.5) / bins), Y(rel.yes[i]! / n), px(2 + Math.min(4, Math.sqrt(n))), 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- tickets -----------------------------------------------------------------------------

function ticket(c: DispatchCard): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "ticket";
  if (c.verdict) li.dataset.verdict = c.verdict;

  const head = document.createElement("div");
  head.className = "ticket-head";
  const left = document.createElement("span");
  const b = document.createElement("b");
  b.textContent = `#${c.id}`;
  left.append(b, ` · ${fmtClock(c.t)} · ${c.district}`);
  const right = document.createElement("span");
  right.className = "ticket-lag";
  right.textContent = c.latencyMs ? `answered in ${(c.latencyMs / 1000).toFixed(1)} s` : c.sendP === undefined ? "ringing" : "";
  head.append(left, right);

  const text = document.createElement("p");
  text.className = "ticket-text";
  text.textContent = `“${c.transcript}”`;
  li.append(head, text);

  if (c.sendP !== undefined) {
    const answer = document.createElement("div");
    answer.className = "ticket-answer";
    const bar = document.createElement("span");
    bar.className = "sendbar";
    const i = document.createElement("i");
    i.style.setProperty("--p", `${Math.round(c.sendP * 100)}%`);
    bar.append("send", i, c.sendP.toFixed(2));
    answer.append(bar);
    const send = c.sendP >= 0.5 && c.service;
    const service = document.createElement("span");
    service.className = send ? "chip" : "chip chip-off";
    service.textContent = send ? SERVICE_LABEL[c.service!] : "No unit";
    answer.append(service);
    if (send && c.priority !== undefined) {
      const prio = document.createElement("span");
      prio.className = "chip";
      prio.dataset.prio = String(c.priority);
      prio.textContent = PRIORITY_LABEL[c.priority]!;
      answer.append(prio);
    }
    li.append(answer);
  }
  if (c.outcome) {
    const out = document.createElement("p");
    out.className = "ticket-outcome";
    out.textContent = `${c.verdict === "good" ? "✓" : "✗"} ${c.outcome}`;
    li.append(out);
  }
  return li;
}

// --- adapter -------------------------------------------------------------------------------

const avg = (sum: number, n: number) => (n ? sum / n : 0);

runArena<DispatchView>({
  gameId: "dispatch",
  subtitle: "Emergency calls · Riverton",
  intro: "Pick the controllers and press Start match. Every dispatcher hears the same calls, from the same seed. The code picks the nearest unit; the model only answers send, which service, and how urgent.",
  modeText: {
    realtime: "Real time: calls keep coming while each dispatcher thinks. Time spent deciding is time the caller waits.",
    turn: "Turn based: the city waits for every answer. Only judgment counts.",
  },
  ownFeed: true,
  legend: [
    { svg: '<circle cx="6" cy="6" r="4.5" class="lg-ringing" fill="none"/>', text: "Call ringing, not answered yet" },
    { svg: '<circle cx="6" cy="6" r="5" class="lg-critical"/>', text: "Critical" },
    { svg: '<circle cx="6" cy="6" r="4" class="lg-urgent"/>', text: "Urgent" },
    { svg: '<circle cx="6" cy="6" r="3" class="lg-low"/>', text: "Low" },
    { svg: '<rect x="1" y="3" width="10" height="6" class="lg-unit"/>', text: "Unit (F fire, A ambulance, P police)" },
  ],
  board: [
    { label: "Correct", value: (l) => `${l.metrics.correct ?? 0}/${l.metrics.answered ?? 0}` },
    { label: "Missed", value: (l) => String(l.metrics.missed ?? 0), bad: (l) => (l.metrics.missed ?? 0) > 0 },
    { label: "Wrong unit", value: (l) => String(l.metrics.wrongService ?? 0), bad: (l) => (l.metrics.wrongService ?? 0) > 0 },
    { label: "Wasted", value: (l) => String(l.metrics.wasted ?? 0), bad: (l) => (l.metrics.wasted ?? 0) > 0 },
    {
      label: "Critical resp.",
      value: (l) => (l.metrics.criticalResponses ? fmtClock(avg(l.metrics.criticalResponseSum ?? 0, l.metrics.criticalResponses)) : "–"),
    },
    { label: "Score", value: (l) => String(l.score), score: true },
  ],
  stateLine(lane, mode) {
    if (lane.done) return "Shift over";
    const waiting = lane.view.ringing;
    const queue = waiting > (lane.busy ? 1 : 0) ? ` · ${waiting - (lane.busy ? 1 : 0)} more ringing` : "";
    if (lane.busy) return mode === "realtime" ? `On a call · caller waiting ${lane.viewAgeS.toFixed(1)} s${queue}` : `On a call · the city is waiting${queue}`;
    return waiting ? `${waiting} calls ringing` : "Waiting for calls";
  },
  mountBody(container, _lane, below) {
    const map = document.createElement("canvas");
    map.className = "stage";
    map.setAttribute("role", "img");
    map.setAttribute("aria-label", "City map with incidents and units");

    const calib = document.createElement("div");
    calib.className = "calib";
    const title = document.createElement("span");
    title.className = "calib-title";
    title.textContent = "Calibration of “send a unit”";
    const brier = document.createElement("span");
    brier.className = "calib-brier";
    brier.textContent = "–";
    const chart = document.createElement("canvas");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", "Reliability diagram: predicted probability against how often a unit was really needed");
    calib.append(title, brier, chart);
    container.append(map, calib);

    const list = document.createElement("ol");
    list.className = "tickets";
    list.setAttribute("aria-label", "Calls");
    below.append(list);

    const p = palette();
    const mapCanvas = fitCanvas(map);
    const chartCanvas = fitCanvas(chart);
    let view: DispatchView | null = null;
    let ticketsKey = "";

    return {
      update(lane: Lane) {
        view = lane.view;
        const n = lane.metrics.answered ?? 0;
        brier.textContent = n ? `Brier ${(lane.metrics.brier ?? 0).toFixed(3)} · ${n} calls` : "–";
        const key = lane.view.cards.map((c) => `${c.id}:${c.sendP ?? ""}:${c.verdict ?? ""}`).join("|");
        if (key !== ticketsKey) {
          ticketsKey = key;
          list.replaceChildren(...lane.view.cards.map(ticket));
        }
      },
      draw(now) {
        if (!view) return;
        const m = mapCanvas.size();
        drawCity(mapCanvas.ctx, Math.min(m.w, m.h), m.dpr, view, p, now);
        const c = chartCanvas.size();
        drawCalibration(chartCanvas.ctx, c.w, c.h, c.dpr, view.reliability, p);
      },
    };
  },
});
