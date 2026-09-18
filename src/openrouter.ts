// Calls to OpenRouter, with retries. How a request reaches OpenRouter is pluggable:
//  - Bun (CLI benches, local server): directly, with OPENROUTER_API_KEY from .env
//  - the browser: through this site's /api/openrouter proxy, which holds the key
import { env, sleep } from "./runtime";

const BASE = "https://openrouter.ai/api";

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sends one POST to an OpenRouter API path (e.g. "/alpha/decisions") and returns the raw response. */
export type Transport = (path: string, body: unknown, signal: AbortSignal) => Promise<Response>;

const direct: Transport = (path, body, signal) => {
  const key = env("OPENROUTER_API_KEY");
  if (!key) throw new OpenRouterError(0, "OPENROUTER_API_KEY is not set. Add it to .env");
  return fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "Decision Arena" },
    body: JSON.stringify(body),
    signal,
  });
};

let transport: Transport = direct;

export function setTransport(t: Transport): void {
  transport = t;
}

function errorMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    return body.error?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/** POST with retries on network errors, 429 (honouring Retry-After) and 5xx. Other 4xx fail immediately. */
export async function openrouter<T>(path: string, body: unknown, { retries = 3, timeoutMs = 45_000 } = {}): Promise<T> {
  let lastError: unknown;
  let waitMs = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(waitMs || 300 * 2 ** (attempt - 1));
    waitMs = 0;
    try {
      const res = await transport(path, body, AbortSignal.timeout(timeoutMs));
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as T;
      const detail = errorMessage(text);
      lastError = new OpenRouterError(res.status, detail.startsWith("HTTP ") ? detail : `HTTP ${res.status}: ${detail}`);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        // Per-minute windows: back off 5, 10, 20 s unless the server says otherwise.
        waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt;
      } else if (res.status < 500) break;
    } catch (e) {
      if (e instanceof OpenRouterError && e.status === 0) throw e;
      lastError = e;
    }
  }
  throw lastError;
}
