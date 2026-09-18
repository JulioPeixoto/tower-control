// Browser side shared by the arena games: console header, setup form, one panel per
// controller (strip, game body, board, feed), WebSocket plumbing and end-of-match stamp.
// A game only supplies how to draw its world and which six numbers go on the board.
import type { ArenaClientMessage, ArenaConfig, ArenaFrame, ArenaLaneFrame, ArenaLaneResult, ArenaServerMessage, GameInfo, Mode } from "../../src/arena/protocol";
import type { FeedLine } from "../../src/arena/types";
import { fmtClock } from "../../src/sim/geometry";

export interface BoardCell<V> {
  label: string;
  value: (lane: ArenaLaneFrame<V>) => string;
  bad?: (lane: ArenaLaneFrame<V>) => boolean;
  score?: boolean;
}

export interface PanelBody<V> {
  update(lane: ArenaLaneFrame<V>, frame: ArenaFrame<V>): void;
  /** Called on every animation frame (about 30 fps). */
  draw?(now: number): void;
}

export interface ArenaAdapter<V> {
  gameId: string;
  subtitle: string;
  intro: string;
  modeText: Record<Mode, string>;
  legend?: { svg: string; text: string }[];
  board: BoardCell<V>[];
  /** `container` sits above the board, `below` under it (for logs, tickets and the like). */
  mountBody(container: HTMLElement, lane: ArenaLaneFrame<V>, below: HTMLElement): PanelBody<V>;
  stateLine?(lane: ArenaLaneFrame<V>, mode: Mode): string | null;
  /** Set when the body shows its own log, so the generic feed is hidden. */
  ownFeed?: boolean;
  /** Stamp text for the best score. */
  stamp?: string;
}

interface Panel<V> {
  root: HTMLElement;
  body: PanelBody<V>;
  feedKey: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);
export const dollars = (usd: number) => (usd === 0 ? "$0" : usd < 0.1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`);

/** Keeps a canvas at device resolution for its CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement, onResize?: () => void): { ctx: CanvasRenderingContext2D; size: () => { w: number; h: number; dpr: number } } {
  const ctx = canvas.getContext("2d")!;
  let w = 1;
  let h = 1;
  let dpr = 1;
  new ResizeObserver(([entry]) => {
    dpr = window.devicePixelRatio || 1;
    w = Math.max(1, Math.floor(entry!.contentRect.width * dpr));
    h = Math.max(1, Math.floor(entry!.contentRect.height * dpr));
    canvas.width = w;
    canvas.height = h;
    onResize?.();
  }).observe(canvas);
  return { ctx, size: () => ({ w, h, dpr }) };
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function runArena<V>(adapter: ArenaAdapter<V>): void {
  const params = new URLSearchParams(location.search);
  const panels = new Map<string, Panel<V>>();
  let info: GameInfo | null = null;
  let ws: WebSocket | null = null;
  let running = false;
  let mode: Mode = "realtime";
  let matchId = 0;
  let ignoreUpTo = 0;

  // --- page skeleton ----------------------------------------------------------------
  const header = el("header", "console");
  const ident = el("div", "ident");
  const back = el("a", "back", "Decision Arena");
  back.href = "/";
  const title = el("h1", "ident-name", "…");
  ident.append(back, title, el("p", "ident-sub", adapter.subtitle));

  const form = el("form", "setup");
  const clock = el("div", "clock");
  const clockValue = el("span", "clock-value", "00:00");
  clock.append(el("span", "field-label", "Sim time"), clockValue);
  header.append(ident, form, clock);

  const status = el("p", "status", "Connecting to the server…");
  status.setAttribute("role", "status");
  const scopes = el("main", "scopes");
  document.body.append(header, status, scopes);

  if (adapter.legend?.length) {
    const legend = el("footer", "legend");
    legend.setAttribute("aria-label", "Legend");
    for (const item of adapter.legend) {
      const span = el("span");
      span.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true">${item.svg}</svg>`;
      span.append(item.text);
      legend.append(span);
    }
    document.body.append(legend);
  }

  const setStatus = (text: string, tone: "info" | "error" = "info") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  let goButton: HTMLButtonElement;
  const setRunning = (value: boolean) => {
    running = value;
    if (!goButton) return;
    goButton.textContent = value ? "Stop match" : "Start match";
    goButton.toggleAttribute("data-running", value);
  };

  // --- form ------------------------------------------------------------------------
  function field(label: string, control: HTMLElement): HTMLElement {
    const wrap = el("label", "field");
    wrap.append(el("span", "field-label", label), control);
    return wrap;
  }

  function toggleGroup(label: string, name: string, type: "radio" | "checkbox", items: { value: string; label: string; title?: string; checked: boolean }[]): HTMLElement {
    const wrap = el("div", "field");
    wrap.setAttribute("role", "group");
    const lab = el("span", "field-label", label);
    lab.id = `lbl-${name}`;
    wrap.setAttribute("aria-labelledby", lab.id);
    const row = el("div", "toggles");
    for (const item of items) {
      const l = el("label", "toggle");
      if (item.title) l.title = item.title;
      const input = el("input");
      input.type = type;
      input.name = name;
      input.value = item.value;
      input.checked = item.checked;
      l.append(input, el("span", undefined, item.label));
      row.append(l);
    }
    wrap.append(lab, row);
    return wrap;
  }

  function buildForm(game: GameInfo): void {
    title.textContent = game.title;
    document.title = game.title;
    form.replaceChildren();

    const level = el("select");
    level.name = "level";
    for (const { level: n, name } of game.levels) {
      const opt = new Option(`${n} · ${name}`, String(n));
      opt.selected = String(n) === (params.get("level") ?? String(game.defaultLevel));
      level.append(opt);
    }
    const seed = el("input");
    seed.type = "number";
    seed.name = "seed";
    seed.min = "1";
    seed.value = params.get("seed") ?? "42";
    const speed = el("select");
    speed.name = "speed";
    for (const s of game.speeds) {
      const opt = new Option(`${s}×`, String(s));
      opt.selected = String(s) === (params.get("speed") ?? String(game.defaultSpeed));
      speed.append(opt);
    }
    const wantMode = params.get("mode") === "turn" ? "turn" : "realtime";
    form.append(
      field("Level", level),
      field("Seed", seed),
      toggleGroup("Clock", "mode", "radio", [
        { value: "realtime", label: "Real time", checked: wantMode === "realtime" },
        { value: "turn", label: "Turn based", checked: wantMode === "turn" },
      ]),
      field("Sim speed", speed),
    );
    for (const opt of game.options) {
      const want = params.get(opt.key) ?? opt.default;
      form.append(toggleGroup(opt.label, `opt-${opt.key}`, "radio", opt.values.map((v) => ({ value: v.value, label: v.label, checked: v.value === want }))));
    }
    const wanted = params.get("controllers")?.split(",") ?? game.defaultControllers;
    form.append(
      toggleGroup(
        "Controllers",
        "controllers",
        "checkbox",
        game.controllers.map((c) => ({ value: c.id, label: c.label, title: c.model ?? "Rule-based baseline", checked: wanted.includes(c.id) })),
      ),
    );
    goButton = el("button", "go", "Start match");
    goButton.type = "submit";
    form.append(goButton);
    setRunning(running);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (running) send({ type: "stop" });
    else start();
  });

  function start(): void {
    if (!info) return;
    const data = new FormData(form);
    const controllers = data.getAll("controllers").map(String);
    if (!controllers.length) {
      setStatus("Pick at least one controller to start a match.", "error");
      return;
    }
    mode = data.get("mode") === "turn" ? "turn" : "realtime";
    const options = Object.fromEntries(info.options.map((o) => [o.key, String(data.get(`opt-${o.key}`) ?? o.default)]));
    const config: ArenaConfig = {
      game: info.id,
      level: Number(data.get("level")),
      seed: Number(data.get("seed")) || 42,
      mode,
      speed: Number(data.get("speed")) || info.defaultSpeed,
      controllers,
      options,
    };
    clearPanels();
    ignoreUpTo = Math.max(ignoreUpTo, matchId);
    send({ type: "start", config });
    setRunning(true);
    setStatus(adapter.modeText[mode]);
  }

  // --- connection ------------------------------------------------------------------
  function connect(): void {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${adapter.gameId}`);
    ws.onmessage = (ev) => handle(JSON.parse(String(ev.data)) as ArenaServerMessage<V>);
    ws.onclose = () => {
      setStatus("Lost the connection to the server. Reconnecting…", "error");
      setRunning(false);
      setTimeout(connect, 1500);
    };
  }

  function send(msg: ArenaClientMessage): void {
    ws?.send(JSON.stringify(msg));
  }

  function handle(msg: ArenaServerMessage<V>): void {
    switch (msg.type) {
      case "hello": {
        const first = !info;
        info = msg.game;
        if (first) buildForm(msg.game);
        setStatus(msg.running ? "A match is already running. Its panels appear with the next update." : adapter.intro);
        if (first && params.has("autostart")) start();
        break;
      }
      case "frame":
        onFrame(msg);
        break;
      case "end":
        if (msg.matchId === matchId) onEnd(msg.lanes, msg.file, msg.stopped);
        break;
      case "error":
        setStatus(msg.message, "error");
        setRunning(false);
        break;
    }
  }

  // --- panels -------------------------------------------------------------------------
  function clearPanels(): void {
    for (const p of panels.values()) p.root.remove();
    panels.clear();
  }

  function panelFor(lane: ArenaLaneFrame<V>): Panel<V> {
    const existing = panels.get(lane.id);
    if (existing) return existing;

    const root = el("section", `scope kind-${lane.kind}`);
    const strip = el("header", "strip");
    const id = el("div", "strip-id");
    id.append(el("h2", "strip-name", lane.label), el("p", "strip-model", lane.model ?? "rule-based baseline"));
    const stats = el("dl", "strip-stats");
    for (const [k, label] of [
      ["p50", "p50"],
      ["p95", "p95"],
      ["cost", "Spent"],
      ["calls", "Calls"],
    ] as const) {
      const cell = el("div");
      const dd = el("dd", undefined, k === "calls" ? "0" : "–");
      dd.dataset.k = k;
      cell.append(el("dt", undefined, label), dd);
      stats.append(cell);
    }
    const state = el("p", "strip-state", "Waiting");
    state.dataset.k = "state";
    const stamp = el("span", "stamp", adapter.stamp ?? "Best score");
    stamp.hidden = true;
    strip.append(id, stats, state, stamp);

    const bodyEl = el("div", "panel-body");
    const board = el("dl", "board");
    adapter.board.forEach((cell, i) => {
      const div = el("div", cell.score ? "board-score" : undefined);
      const dd = el("dd", undefined, "–");
      dd.dataset.k = `b${i}`;
      div.append(el("dt", undefined, cell.label), dd);
      board.append(div);
    });
    const below = el("div", "panel-below");
    root.append(strip, bodyEl, board, below);
    if (!adapter.ownFeed) {
      const feed = el("ol", "radio");
      feed.setAttribute("aria-label", "Decision log");
      root.append(feed);
    }
    scopes.append(root);

    const panel: Panel<V> = { root, body: adapter.mountBody(bodyEl, lane, below), feedKey: "" };
    panels.set(lane.id, panel);
    return panel;
  }

  const setText = (root: ParentNode, key: string, value: string) => {
    const node = root.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (node && node.textContent !== value) node.textContent = value;
    return node;
  };

  function onFrame(frame: ArenaFrame<V>): void {
    if (frame.matchId <= ignoreUpTo) return;
    if (frame.matchId !== matchId) {
      clearPanels();
      matchId = frame.matchId;
    }
    mode = frame.config.mode;
    if (!running && !frame.done) setRunning(true);
    clockValue.textContent = fmtClock(frame.t);
    for (const lane of frame.lanes) updatePanel(panelFor(lane), lane, frame);
  }

  function updatePanel(panel: Panel<V>, lane: ArenaLaneFrame<V>, frame: ArenaFrame<V>): void {
    const { root } = panel;
    const isBot = lane.kind === "bot";
    setText(root, "p50", isBot ? "–" : seconds(lane.stats.p50Ms));
    setText(root, "p95", isBot ? "–" : seconds(lane.stats.p95Ms));
    setText(root, "cost", dollars(lane.stats.costUsd));
    setText(root, "calls", String(lane.stats.calls));

    let text = adapter.stateLine?.(lane, mode) ?? null;
    if (text === null) {
      if (lane.done) text = "Finished";
      else if (lane.busy && mode === "realtime") text = `Deciding · working from a picture ${lane.viewAgeS.toFixed(1)} s old`;
      else if (lane.busy) text = "Deciding · the world is waiting";
      else text = "Watching";
    }
    if (lane.stats.errors) text += ` · ${lane.stats.errors} failed ${lane.stats.errors === 1 ? "call" : "calls"}`;
    const state = setText(root, "state", text);
    state?.toggleAttribute("data-busy", lane.busy);

    adapter.board.forEach((cell, i) => {
      const node = setText(root, `b${i}`, cell.value(lane));
      node?.toggleAttribute("data-bad", cell.bad?.(lane) ?? false);
    });

    panel.body.update(lane, frame);
    if (!adapter.ownFeed) renderFeed(panel, lane.feed);
  }

  function renderFeed(panel: Panel<V>, feed: FeedLine[]): void {
    const last = feed[feed.length - 1];
    const key = last ? `${feed.length}:${last.t}:${last.text}` : "";
    if (key === panel.feedKey) return;
    panel.feedKey = key;
    const list = panel.root.querySelector<HTMLOListElement>(".radio")!;
    list.replaceChildren(
      ...feed
        .slice(-18)
        .reverse()
        .map((l) => {
          const li = el("li", `r-${l.kind}`);
          const body = el("span");
          if (l.who) body.append(el("b", undefined, `${l.who} `));
          body.append(l.text);
          if (l.latencyMs) body.append(el("em", undefined, ` +${(l.latencyMs / 1000).toFixed(1)} s`));
          li.append(el("time", undefined, fmtClock(l.t)), body);
          return li;
        }),
    );
  }

  function onEnd(lanes: ArenaLaneResult[], file: string | null, stopped: boolean): void {
    setRunning(false);
    const best = Math.max(...lanes.map((l) => l.score));
    for (const l of lanes) {
      const stamp = panels.get(l.id)?.root.querySelector<HTMLElement>(".stamp");
      if (stamp) stamp.hidden = stopped || lanes.length < 2 || l.score !== best;
    }
    const ranking = [...lanes]
      .sort((a, b) => b.score - a.score)
      .map((l) => `${l.label} ${l.score}`)
      .join(" · ");
    setStatus(`${stopped ? "Match stopped" : "Match over"}. ${ranking}.${file ? ` Full log saved to ${file}.` : ""}`);
  }

  // --- render loop ----------------------------------------------------------------------
  let lastDraw = 0;
  const loop = (now: number) => {
    if (now - lastDraw > 33) {
      lastDraw = now;
      for (const p of panels.values()) p.body.draw?.(now);
    }
    requestAnimationFrame(loop);
  };
  document.fonts.ready.then(() => requestAnimationFrame(loop));
  connect();
}
