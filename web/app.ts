import type { ControllerInfo } from "../src/controllers/index";
import type { ClientMessage, Frame, LaneFrame, LaneResult, MatchConfig, ServerMessage } from "../src/protocol";
import { fmtClock } from "../src/sim/geometry";
import type { RadioLine } from "../src/sim/types";
import { drawRadar, readPalette } from "./radar";

interface Panel {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  lane?: LaneFrame;
  radioKey: string;
}

const form = document.querySelector<HTMLFormElement>("#setup")!;
const levelSelect = document.querySelector<HTMLSelectElement>("#level")!;
const controllersBox = document.querySelector<HTMLElement>("#controllers")!;
const goButton = document.querySelector<HTMLButtonElement>("#go")!;
const scopes = document.querySelector<HTMLElement>("#scopes")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const clockEl = document.querySelector<HTMLElement>("#clock")!;
const template = document.querySelector<HTMLTemplateElement>("#scope-tpl")!;

const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const palette = readPalette();
const panels = new Map<string, Panel>();
const DEFAULT_CONTROLLERS = ["jev", "luna", "haiku"];
const IDLE_STATUS = "Pick the controllers and press Start match. Every scope gets the same traffic from the same seed.";

let ws: WebSocket | null = null;
let running = false;
let currentMode: MatchConfig["mode"] = "realtime";
let initialized = false;
/** Match shown on screen, and the newest match this page already left behind. */
let matchId = 0;
let ignoreUpTo = 0;

// --- connection -------------------------------------------------------------

function connect(): void {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onmessage = (ev) => handle(JSON.parse(String(ev.data)) as ServerMessage);
  ws.onclose = () => {
    setStatus("Lost the connection to the server. Reconnecting…", "error");
    setRunning(false);
    setTimeout(connect, 1500);
  };
}

function send(msg: ClientMessage): void {
  ws?.send(JSON.stringify(msg));
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case "hello":
      if (!initialized) setupForm(msg.controllers, msg.levels);
      setStatus(msg.running ? "A match is already running. Its scopes appear with the next update." : IDLE_STATUS);
      if (!initialized && params.has("autostart")) startMatch();
      initialized = true;
      break;
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

// --- form -------------------------------------------------------------------

function setupForm(controllers: ControllerInfo[], levels: { level: number; name: string }[]): void {
  levelSelect.replaceChildren(
    ...levels.map(({ level, name }) => {
      const opt = new Option(`${level} · ${name}`, String(level));
      opt.selected = String(level) === (params.get("level") ?? "3");
      return opt;
    }),
  );

  const wanted = params.get("controllers")?.split(",") ?? DEFAULT_CONTROLLERS;
  controllersBox.replaceChildren(
    ...controllers.map((c) => {
      const label = document.createElement("label");
      label.className = "toggle";
      label.title = c.model ?? "Rule-based baseline";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "controllers";
      input.value = c.id;
      input.checked = wanted.includes(c.id);
      const span = document.createElement("span");
      span.textContent = c.label;
      label.append(input, span);
      return label;
    }),
  );

  const seed = params.get("seed");
  if (seed) (form.elements.namedItem("seed") as HTMLInputElement).value = seed;
  const mode = params.get("mode");
  if (mode === "turn" || mode === "realtime") (form.querySelector(`input[name=mode][value=${mode}]`) as HTMLInputElement).checked = true;
  const speed = params.get("speed");
  if (speed) (form.elements.namedItem("speed") as HTMLSelectElement).value = speed;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (running) send({ type: "stop" });
  else startMatch();
});

function startMatch(): void {
  const data = new FormData(form);
  const controllers = data.getAll("controllers").map(String);
  if (!controllers.length) {
    setStatus("Pick at least one controller to start a match.", "error");
    return;
  }
  const mode = data.get("mode") === "turn" ? "turn" : "realtime";
  const config: MatchConfig = {
    level: Number(data.get("level")),
    seed: Number(data.get("seed")) || 42,
    mode,
    speed: Number(data.get("speed")) || 8,
    decisionEvery: mode === "turn" ? 10 : 2,
    controllers,
  };
  clearPanels();
  ignoreUpTo = Math.max(ignoreUpTo, matchId);
  currentMode = mode;
  send({ type: "start", config });
  setRunning(true);
  setStatus(
    mode === "realtime"
      ? "Real time: the traffic keeps moving while each controller thinks. Slow answers land on an old picture."
      : "Turn based: the traffic waits for every controller before moving on. Only decision quality counts.",
  );
}

function setRunning(value: boolean): void {
  running = value;
  goButton.textContent = value ? "Stop match" : "Start match";
  goButton.toggleAttribute("data-running", value);
}

function setStatus(text: string, tone: "info" | "error" = "info"): void {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

// --- panels -----------------------------------------------------------------

function clearPanels(): void {
  for (const p of panels.values()) p.root.remove();
  panels.clear();
}

function panelFor(lane: LaneFrame): Panel {
  const existing = panels.get(lane.id);
  if (existing) return existing;

  const root = (template.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
  root.classList.add(`kind-${lane.kind}`);
  root.querySelector(".strip-name")!.textContent = lane.label;
  root.querySelector(".strip-model")!.textContent = lane.model ?? "rule-based baseline";
  const canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
  canvas.setAttribute("aria-label", `Radar scope for ${lane.label}`);
  scopes.append(root);

  const panel: Panel = { root, canvas, ctx: canvas.getContext("2d")!, size: 0, radioKey: "" };
  new ResizeObserver(([entry]) => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(entry!.contentRect.width);
    panel.size = Math.max(1, Math.floor(width * dpr));
    canvas.width = canvas.height = panel.size;
  }).observe(canvas);
  panels.set(lane.id, panel);
  return panel;
}

const setText = (root: ParentNode, key: string, value: string) => {
  const el = root.querySelector<HTMLElement>(`[data-k="${key}"]`);
  if (el && el.textContent !== value) el.textContent = value;
};

const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);
const dollars = (usd: number) => (usd === 0 ? "$0" : usd < 0.1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`);

function onFrame(frame: Frame): void {
  currentMode = frame.config.mode;
  if (!running && !frame.done) setRunning(true);
  clockEl.textContent = fmtClock(frame.t);
  for (const lane of frame.lanes) updatePanel(panelFor(lane), lane);
}

function updatePanel(panel: Panel, lane: LaneFrame): void {
  panel.lane = lane;
  const { root } = panel;
  const m = lane.world.metrics;
  const isBot = lane.kind === "bot";

  setText(root, "p50", isBot ? "–" : seconds(lane.stats.p50Ms));
  setText(root, "p95", isBot ? "–" : seconds(lane.stats.p95Ms));
  setText(root, "cost", dollars(lane.stats.costUsd));
  setText(root, "calls", String(lane.stats.calls));

  const state = root.querySelector<HTMLElement>('[data-k="state"]')!;
  let text: string;
  if (lane.world.done) text = "Finished";
  else if (lane.busy && currentMode === "realtime") text = `Deciding · working from a picture ${Math.round(lane.viewAgeS)} s old`;
  else if (lane.busy) text = "Deciding · the traffic is waiting";
  else text = "Watching the traffic";
  if (lane.stats.errors) text += ` · ${lane.stats.errors} failed ${lane.stats.errors === 1 ? "call" : "calls"}`;
  if (state.textContent !== text) state.textContent = text;
  state.toggleAttribute("data-busy", lane.busy);

  const lost = m.crashed + m.exited;
  setText(root, "landed", `${m.landed}/${m.spawned}`);
  setText(root, "lost", String(lost));
  setText(root, "los", String(m.losEvents));
  setText(root, "ga", String(m.goArounds));
  const delays = m.excessDelay;
  setText(root, "delay", delays.length ? fmtClock(delays.reduce((s, d) => s + d, 0) / delays.length) : "–");
  setText(root, "score", String(lane.score));
  root.querySelector('[data-k="lost"]')!.toggleAttribute("data-bad", lost > 0);
  root.querySelector('[data-k="los"]')!.toggleAttribute("data-bad", m.losEvents > 0);

  renderRadio(panel, lane.world.radio);
}

function renderRadio(panel: Panel, radio: RadioLine[]): void {
  const last = radio[radio.length - 1];
  const key = last ? `${radio.length}:${last.t}:${last.text}` : "";
  if (key === panel.radioKey) return;
  panel.radioKey = key;

  const list = panel.root.querySelector<HTMLOListElement>(".radio")!;
  list.replaceChildren(
    ...radio
      .slice(-18)
      .reverse()
      .map((l) => {
        const li = document.createElement("li");
        li.className = `r-${l.kind}`;
        const time = document.createElement("time");
        time.textContent = fmtClock(l.t);
        const body = document.createElement("span");
        const who = document.createElement("b");
        who.textContent = l.to ? `${l.from} → ${l.to} ` : `${l.from} `;
        body.append(who, l.text);
        if (l.latencyMs !== undefined && l.kind === "atc") {
          const lag = document.createElement("em");
          lag.textContent = ` +${(l.latencyMs / 1000).toFixed(1)} s`;
          body.append(lag);
        }
        li.append(time, body);
        return li;
      }),
  );
}

function onEnd(lanes: LaneResult[], file: string | null, stopped: boolean): void {
  setRunning(false);
  const best = Math.max(...lanes.map((l) => l.score));
  for (const l of lanes) {
    const panel = panels.get(l.id);
    if (!panel) continue;
    panel.root.querySelector<HTMLElement>(".stamp")!.hidden = stopped || lanes.length < 2 || l.score !== best;
  }
  const ranking = [...lanes]
    .sort((a, b) => b.score - a.score)
    .map((l) => `${l.label} ${l.score}`)
    .join(" · ");
  setStatus(`${stopped ? "Match stopped" : "Match over"}. ${ranking}.${file ? ` Full log saved to ${file}.` : ""}`);
}

// --- render loop ------------------------------------------------------------

let lastDraw = 0;
function loop(now: number): void {
  if (now - lastDraw > 33) {
    lastDraw = now;
    const dpr = window.devicePixelRatio || 1;
    for (const panel of panels.values()) {
      if (!panel.lane || !panel.size) continue;
      drawRadar(panel.ctx, panel.lane, {
        size: panel.size,
        dpr,
        palette,
        now,
        reducedMotion,
        showGhosts: currentMode === "realtime",
      });
    }
  }
  requestAnimationFrame(loop);
}

document.fonts.ready.then(() => requestAnimationFrame(loop));
connect();
