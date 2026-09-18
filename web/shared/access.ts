// "Model access": how this browser pays for model calls. Bots need nothing. Models need either
// the access code the site owner shared (their key pays) or the visitor's own OpenRouter key.
// Both stay in this browser and go only to this site's /api/openrouter proxy.
import { setTransport } from "../../src/openrouter";

const KEY = "arena.openrouterKey";
const CODE = "arena.accessCode";

function read(name: string): string {
  try {
    return localStorage.getItem(name) ?? "";
  } catch {
    return "";
  }
}

function write(name: string, value: string): void {
  try {
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    // Private mode or blocked storage: access lasts for this page only.
    memory.set(name, value);
  }
}

const memory = new Map<string, string>();
const get = (name: string) => memory.get(name) ?? read(name);

/** Running on this machine with `bun run dev`: the local server pays with .env, no code needed. */
export const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

export function hasAccess(): boolean {
  return isLocal || !!get(KEY) || !!get(CODE);
}

// Model calls from the games go through the proxy with whatever access is set.
setTransport((path, body, signal) =>
  fetch("/api/openrouter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(get(KEY) ? { "x-openrouter-key": get(KEY) } : {}),
      ...(get(CODE) ? { "x-arena-code": get(CODE) } : {}),
    },
    body: JSON.stringify({ path, body }),
    signal,
  }),
);

const listeners = new Set<() => void>();

function status(): string {
  if (get(KEY)) return "Your key";
  if (get(CODE)) return "Access code";
  return isLocal ? "Local key" : "Bots only";
}

/** A header button that shows the current access and opens the dialog. */
export function accessButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "access-button";
  const render = () => {
    button.textContent = `Model access · ${status()}`;
    button.toggleAttribute("data-open", hasAccess());
  };
  render();
  listeners.add(render);
  button.addEventListener("click", () => openAccessDialog());
  return button;
}

let dialog: HTMLDialogElement | null = null;

export function openAccessDialog(reason?: string): void {
  if (!dialog) dialog = buildDialog();
  const why = dialog.querySelector<HTMLElement>(".access-why")!;
  why.textContent = reason ?? "";
  why.hidden = !reason;
  (dialog.querySelector("[name=code]") as HTMLInputElement).value = get(CODE);
  (dialog.querySelector("[name=key]") as HTMLInputElement).value = get(KEY);
  dialog.showModal();
}

function buildDialog(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "access";
  d.innerHTML = `
    <form method="dialog" class="access-form">
      <h2 class="access-title">Model access</h2>
      <p class="access-why" hidden></p>
      <p class="access-text">The bots run without anything. To run Jev and the LLMs, enter the access code you were given, or your own OpenRouter key. Both stay in this browser and are only sent to this site's proxy, which forwards the call to OpenRouter.</p>
      <label class="field"><span class="field-label">Access code</span><input name="code" type="password" autocomplete="off" /></label>
      <label class="field"><span class="field-label">Your OpenRouter key</span><input name="key" type="password" autocomplete="off" placeholder="sk-or-…" /></label>
      <p class="access-note">If both are set, your own key is used.</p>
      <div class="access-actions">
        <button value="clear" class="access-secondary">Clear both</button>
        <button value="cancel" class="access-secondary">Cancel</button>
        <button value="save" class="go">Save</button>
      </div>
    </form>`;
  d.addEventListener("close", () => {
    if (d.returnValue === "save") {
      write(CODE, (d.querySelector("[name=code]") as HTMLInputElement).value.trim());
      write(KEY, (d.querySelector("[name=key]") as HTMLInputElement).value.trim());
    } else if (d.returnValue === "clear") {
      write(CODE, "");
      write(KEY, "");
    }
    listeners.forEach((fn) => fn());
  });
  document.body.append(d);
  return d;
}
