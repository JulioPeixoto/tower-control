import type { ArenaLaneFrame } from "../../src/arena/protocol";
import { PRIORITY_LABEL, SERVICE_LABEL, STATIONS } from "../../src/games/dispatch/city";
import type { DispatchCard, DispatchView } from "../../src/games/dispatch/world";
import { fmtClock } from "../../src/sim/geometry";
import { fitCanvas, runArena } from "../shared/arena";
import { cityPalette, drawCity, type CityPalette } from "../shared/city-map";

type Lane = ArenaLaneFrame<DispatchView>;

const STATION_MARKS = STATIONS.map((s) => ({ x: s.x, y: s.y, letter: s.service === "fire" ? "F" : s.service === "medical" ? "H" : "P" }));

// --- reliability diagram -------------------------------------------------------------------

function drawCalibration(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, rel: DispatchView["reliability"], p: CityPalette): void {
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

    const p = cityPalette();
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
        drawCity(mapCanvas.ctx, Math.min(m.w, m.h), m.dpr, view, STATION_MARKS, p, now);
        const c = chartCanvas.size();
        drawCalibration(chartCanvas.ctx, c.w, c.h, c.dpr, view.reliability, p);
      },
    };
  },
});
