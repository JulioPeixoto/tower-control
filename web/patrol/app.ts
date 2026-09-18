import type { ArenaFrame, ArenaLaneFrame, Mode } from "../../src/arena/protocol";
import { PATROL_STATIONS, type BiasRow, type PatrolCard, type PatrolView } from "../../src/games/patrol/world";
import { fmtClock } from "../../src/sim/geometry";
import { fitCanvas, runArena } from "../shared/arena";
import { cityPalette, drawCity } from "../shared/city-map";

type Lane = ArenaLaneFrame<PatrolView>;

const STATION_MARKS = PATROL_STATIONS.map((s) => ({ x: s.x, y: s.y, letter: "P" }));
const VARIANT_LABEL = { black: "Black", white: "white", none: "not stated" } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- the mirror -----------------------------------------------------------------------------

function mountMirror(container: HTMLElement) {
  const box = el("section", "mirror");
  const head = el("div", "mirror-head");
  head.append(el("span", "mirror-title", "Same scene, different person"), el("span", "mirror-key", "B Black · W white · | not stated"));
  const rows = el("ol", "mirror-rows");
  box.append(head, rows);
  container.append(box);
  const made = new Map<string, { b: HTMLElement; w: HTMLElement; n: HTMLElement; gap: HTMLElement }>();

  return (bias: BiasRow[]) => {
    for (const r of bias) {
      let row = made.get(r.key);
      if (!row) {
        const li = el("li", "mirror-row");
        const track = el("div", "mirror-track");
        const b = el("span", "mk mk-black", "B");
        const w = el("span", "mk mk-white", "W");
        const n = el("span", "mk mk-none");
        track.append(n, b, w);
        const gap = el("span", "mirror-gap", "–");
        li.append(el("span", "mirror-label", r.label), track, gap);
        rows.append(li);
        row = { b, w, n, gap };
        made.set(r.key, row);
      }
      const place = (m: HTMLElement, v: number | null, who: string) => {
        m.hidden = v === null;
        if (v !== null) {
          m.style.left = `${(Math.min(r.max, Math.max(0, v)) / r.max) * 100}%`;
          m.title = `${who}: ${v.toFixed(2)}`;
        }
      };
      place(row.b, r.black, "Black");
      place(row.w, r.white, "white");
      place(row.n, r.none, "not stated");
      if (r.black !== null && r.white !== null) {
        const gap = r.black - r.white;
        row.gap.textContent = `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(2)}`;
        row.gap.title = "Black minus white";
        row.gap.toggleAttribute("data-big", Math.abs(gap) / r.max >= 0.1);
      } else {
        row.gap.textContent = "–";
        row.gap.removeAttribute("data-big");
      }
    }
  };
}

// --- tickets -------------------------------------------------------------------------------

function ticket(c: PatrolCard): HTMLLIElement {
  const li = el("li", "ticket");
  if (c.verdict) li.dataset.verdict = c.verdict;
  const head = el("div", "ticket-head");
  const left = el("span");
  left.append(el("b", undefined, c.id), ` · ${fmtClock(c.t)} · ${c.district} · ${c.call ? "call" : "patrol stop"} `, el("span", "tag-variant", VARIANT_LABEL[c.variant]));
  head.append(left);
  li.append(head);

  if (c.call) li.append(el("p", "ticket-text", `“${c.call}”`));
  if (c.sendP !== undefined) {
    const a = el("div", "ticket-answer");
    const send = c.sendP >= 0.5;
    a.append(el("span", send ? "chip" : "chip chip-off", send ? `Car sent · priority ${c.priority}` : "No car"), el("span", "ticket-lag", `p ${c.sendP.toFixed(2)}`));
    li.append(a);
  }
  if (c.scene) {
    const body = el("div", "ticket-body");
    if (c.photo) {
      const img = el("img", "ticket-photo");
      img.src = c.photo;
      img.alt = "Synthetic face (CausalFace) shown to the vision models";
      img.loading = "lazy";
      body.append(img);
    } else body.append(el("span"));
    body.append(el("p", "ticket-scene", `At the scene: ${c.scene}`));
    li.append(body);
  }
  if (c.threat !== undefined) {
    const a = el("div", "ticket-answer");
    a.append(
      el("span", "chip", c.approach ?? "?"),
      el("span", "ticket-lag", `threat ${c.threat.toFixed(1)} · armed ${c.armedP?.toFixed(2)} · search ${c.searchP?.toFixed(2)}`),
    );
    li.append(a);
  }
  if (c.outcome) li.append(el("p", "ticket-outcome", `${c.verdict === "good" ? "✓" : "✗"} ${c.outcome}`));
  return li;
}

// --- adapter --------------------------------------------------------------------------------

runArena<PatrolView>({
  gameId: "patrol",
  subtitle: "Police calls · bias benchmark",
  intro:
    "Every scene is played three times: with the person described as Black, as white, and with no race stated. Nothing else changes. The mirror shows whether a controller treats them differently. Photo mode shows matched synthetic faces to the vision models; Jev cannot see images and decides without them.",
  modeText: {
    realtime: "Real time: calls keep coming and cars keep driving while each controller thinks.",
    turn: "Turn based: the city waits for every answer. Use this for bias measurements.",
  },
  ownFeed: true,
  stamp: "Best score",
  legend: [
    { svg: '<circle cx="6" cy="6" r="4.5" class="lg-ringing" fill="none"/>', text: "Call not answered yet" },
    { svg: '<circle cx="6" cy="6" r="5" class="lg-critical"/>', text: "Critical" },
    { svg: '<circle cx="6" cy="6" r="4" class="lg-urgent"/>', text: "Urgent" },
    { svg: '<circle cx="6" cy="6" r="3" class="lg-low"/>', text: "Low" },
    { svg: '<rect x="1" y="3" width="10" height="6" class="lg-unit"/>', text: "Patrol car" },
  ],
  board: [
    { label: "Calls right", value: (l) => `${l.metrics.callsCorrect ?? 0}/${l.metrics.callsAnswered ?? 0}` },
    { label: "Missed calls", value: (l) => String(l.metrics.missed ?? 0), bad: (l) => (l.metrics.missed ?? 0) > 0 },
    { label: "Car, no crime", value: (l) => String(l.metrics.unneeded ?? 0), bad: (l) => (l.metrics.unneeded ?? 0) > 0 },
    { label: "Missed weapons", value: (l) => String(l.metrics.missedWeapons ?? 0), bad: (l) => (l.metrics.missedWeapons ?? 0) > 0 },
    { label: "Unjust stops", value: (l) => String((l.metrics.unjustDetain ?? 0) + (l.metrics.unjustSearch ?? 0)), bad: (l) => (l.metrics.unjustDetain ?? 0) + (l.metrics.unjustSearch ?? 0) > 0 },
    { label: "Score", value: (l) => String(l.score), score: true },
  ],
  stateLine(lane: Lane, mode: Mode) {
    const blind = lane.view.appearance === "photo" && lane.kind !== "llm" ? "Cannot see photos · " : "";
    if (lane.done) return `${blind}Shift over`;
    const waiting = lane.view.ringing;
    if (lane.busy) return `${blind}${mode === "realtime" ? `Deciding · ${lane.viewAgeS.toFixed(1)} s behind` : "Deciding · the city is waiting"}${waiting > 1 ? ` · ${waiting - 1} more waiting` : ""}`;
    return `${blind}${waiting ? `${waiting} waiting for a decision` : "Waiting for calls"}`;
  },
  mountBody(container, _lane, below) {
    const map = el("canvas", "stage");
    map.setAttribute("role", "img");
    map.setAttribute("aria-label", "City map with calls and patrol cars");
    container.append(map);
    const updateMirror = mountMirror(container);
    const list = el("ol", "tickets");
    list.setAttribute("aria-label", "Calls and scenes");
    below.append(list);

    const p = cityPalette();
    const fit = fitCanvas(map);
    let view: PatrolView | null = null;
    let key = "";
    return {
      update(lane: Lane, _frame: ArenaFrame<PatrolView>) {
        view = lane.view;
        updateMirror(lane.view.bias);
        const k = lane.view.cards.map((c) => `${c.id}:${c.sendP ?? ""}:${c.threat ?? ""}:${c.verdict ?? ""}`).join("|");
        if (k !== key) {
          key = k;
          list.replaceChildren(...lane.view.cards.map(ticket));
        }
      },
      draw(now) {
        if (!view) return;
        const { w, h, dpr } = fit.size();
        drawCity(fit.ctx, Math.min(w, h), dpr, view, STATION_MARKS, p, now);
      },
    };
  },
});
