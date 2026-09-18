// The only server-side piece a deployment needs: forwards a model call from the browser to
// OpenRouter. Used by the Vercel function (api/openrouter.ts) and by the local Bun server.
//
// Which key pays for the call:
//  1. the visitor's own OpenRouter key, if they entered one (header x-openrouter-key)
//  2. the server's OPENROUTER_API_KEY, if they entered the right access code (x-arena-code)
//     or the server allows it without a code (local development)
// Anything else gets 401, so a public deployment cannot spend the owner's credits.
import { ALLOWED_MODELS } from "./models";

const PATHS = new Set(["/alpha/decisions", "/v1/chat/completions"]);
const MAX_BODY_BYTES = 256 * 1024;

export interface ProxyOptions {
  serverKey?: string;
  accessCode?: string;
  /** Local development: use the server key without asking for a code. */
  openWithoutCode?: boolean;
}

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers: { "Content-Type": "application/json" } });

export async function handleProxy(request: Request, opts: ProxyOptions): Promise<Response> {
  if (request.method !== "POST") return json(405, "Use POST.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, "Request too large.");

  let payload: { path?: string; body?: { model?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, "Body must be JSON: { path, body }.");
  }
  const path = payload.path ?? "";
  const model = payload.body?.model ?? "";
  if (!PATHS.has(path)) return json(400, `Path not allowed: ${path}`);
  if (!ALLOWED_MODELS.has(model)) return json(400, `Model not allowed: ${model}`);

  const ownKey = request.headers.get("x-openrouter-key")?.trim();
  const code = request.headers.get("x-arena-code")?.trim();
  let key: string | undefined;
  if (ownKey) key = ownKey;
  else if (opts.serverKey && (opts.openWithoutCode || (opts.accessCode && code === opts.accessCode))) key = opts.serverKey;
  if (!key) {
    return json(
      401,
      code && opts.accessCode
        ? "That access code is not valid. Check it under Model access, or use your own OpenRouter key."
        : "Models need an access code or your own OpenRouter key: open Model access at the top of the page. The bots run without either.",
    );
  }

  const started = Date.now();
  const upstream = await fetch(`https://openrouter.ai/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "Decision Arena" },
    body: JSON.stringify(payload.body),
  });
  const headers = new Headers({ "Content-Type": "application/json", "x-upstream-ms": String(Date.now() - started) });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(await upstream.text(), { status: upstream.status, headers });
}
