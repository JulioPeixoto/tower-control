// Vercel Edge Function behind POST /api/openrouter, bundled by scripts/build.ts.
// The games run in the browser; this forwards their model calls to OpenRouter so the key
// never reaches the page. The rules (who pays, which models) are in src/proxy.ts.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   OPENROUTER_API_KEY   the key that pays for calls made with the access code
//   ARENA_ACCESS_CODE    the code you share with people allowed to use your key
import { handleProxy } from "../proxy";

export default function handler(request: Request): Promise<Response> {
  return handleProxy(request, {
    serverKey: process.env.OPENROUTER_API_KEY,
    accessCode: process.env.ARENA_ACCESS_CODE,
  });
}
