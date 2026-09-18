// Serves the production build (.vercel/output) the way Vercel would: static files first, then
// the page routes from config.json, and the Edge Function at /api/openrouter.
//   bun run build && bun run preview
// Unlike `bun run dev`, the proxy here behaves as deployed: it needs an access code
// (ARENA_ACCESS_CODE in .env) or a visitor's own key.
const OUT = ".vercel/output";
const config = (await Bun.file(`${OUT}/config.json`).json()) as { routes: { src?: string; dest?: string }[] };
const fn = (await import(`../${OUT}/functions/api/openrouter.func/index.js`)).default as (r: Request) => Promise<Response>;

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/api/openrouter") return fn(req);
    const file = Bun.file(`${OUT}/static${path}`);
    if (path !== "/" && (await file.exists())) return new Response(file);
    for (const r of config.routes) {
      if (!r.src || !r.dest) continue;
      const m = path.match(new RegExp(r.src));
      if (m) return new Response(Bun.file(`${OUT}/static${r.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "")}`));
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Preview of the Vercel build at ${server.url}`);
