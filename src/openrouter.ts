const BASE = "https://openrouter.ai/api";

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError(0, "OPENROUTER_API_KEY is not set. Add it to .env");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": "Tower Control",
  };
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
    if (attempt > 0) await Bun.sleep(waitMs || 300 * 2 ** (attempt - 1));
    waitMs = 0;
    try {
      const res = await fetch(BASE + path, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as T;
      lastError = new OpenRouterError(res.status, `HTTP ${res.status}: ${errorMessage(text)}`);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * 2 ** attempt;
      } else if (res.status < 500) break;
    } catch (e) {
      if (e instanceof OpenRouterError && e.status === 0) throw e;
      lastError = e;
    }
  }
  throw lastError;
}
