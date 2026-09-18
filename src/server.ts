// Local development server: the pages (bundled on the fly) and the same OpenRouter proxy the
// Vercel deployment uses. Matches run in the browser tab, exactly as when deployed.
// Locally the proxy pays with OPENROUTER_API_KEY from .env without asking for a code.
import dispatchPage from "../web/dispatch/index.html";
import highwayPage from "../web/highway/index.html";
import homePage from "../web/home/index.html";
import patrolPage from "../web/patrol/index.html";
import sortingPage from "../web/sorting/index.html";
import towerPage from "../web/tower/index.html";
import { handleProxy } from "./proxy";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": homePage,
    "/tower": towerPage,
    "/dispatch": dispatchPage,
    "/sorting": sortingPage,
    "/highway": highwayPage,
    "/patrol": patrolPage,
    "/faces/:file": (req) => {
      // Only plain file names: no paths out of data/faces.
      const file = Bun.file(`data/faces/${req.params.file.replace(/[^\w.-]/g, "")}`);
      return file.size ? new Response(file) : new Response("Photos not installed: run `bun run faces`", { status: 404 });
    },
    "/api/openrouter": {
      POST: (req) =>
        handleProxy(req, {
          serverKey: process.env.OPENROUTER_API_KEY,
          accessCode: process.env.ARENA_ACCESS_CODE,
          openWithoutCode: true,
        }),
    },
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

if (!process.env.OPENROUTER_API_KEY) console.warn("OPENROUTER_API_KEY is not set: only the bots (or a visitor's own key) will work. Add it to .env");
console.log(`Decision Arena running at ${server.url}`);
