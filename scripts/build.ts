// Builds the deployment in Vercel's Build Output API format (.vercel/output):
//   static/      the five pages and their bundled JS and CSS
//   functions/   /api/openrouter as an Edge Function (the only server-side code)
//   config.json  routes: files first, then clean URLs for the pages
// Run with `bun run build`; Vercel runs the same command.
import { mkdir, rm } from "node:fs/promises";

const OUT = ".vercel/output";
const PAGES = ["home", "tower", "dispatch", "sorting", "highway", "patrol"];

function fail(what: string, logs: readonly unknown[]): never {
  console.error(`Build failed: ${what}`);
  for (const log of logs) console.error(log);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });

// Pages. Assets land at the root of static/ with hashed names; pages link to them as
// "../chunk.js", which resolves the same from /, /tower and /tower/.
const pages = await Bun.build({
  entrypoints: PAGES.map((p) => `web/${p}/index.html`),
  outdir: `${OUT}/static`,
  minify: true,
  target: "browser",
});
if (!pages.success) fail("pages", pages.logs);

// The proxy, as a single ESM file for the Edge runtime (Web APIs only).
const fnDir = `${OUT}/functions/api/openrouter.func`;
const fn = await Bun.build({
  entrypoints: ["src/edge/openrouter.ts"],
  outdir: fnDir,
  naming: "index.js",
  target: "browser",
  format: "esm",
  minify: true,
});
if (!fn.success) fail("edge function", fn.logs);
await Bun.write(`${fnDir}/.vc-config.json`, JSON.stringify({ runtime: "edge", entrypoint: "index.js" }, null, 2));

await mkdir(OUT, { recursive: true });
await Bun.write(
  `${OUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "^/$", dest: "/home/index.html" },
        { src: `^/(${PAGES.filter((p) => p !== "home").join("|")})/?$`, dest: "/$1/index.html" },
      ],
    },
    null,
    2,
  ),
);

const size = (n: number) => `${(n / 1024).toFixed(1)} KB`;
for (const o of [...pages.outputs, ...fn.outputs]) console.log(`${o.path.replace(/\\/g, "/").split(".vercel/output/")[1]}  ${size(o.size)}`);
console.log(`\nBuilt ${OUT}`);

// Street Patrol photos (CausalFace subset) are published only if installed locally with
// `bun run faces`; they are git-ignored, so a Vercel build from the repo has none by default.
const { readdir, cp } = await import("node:fs/promises");
const faces = await readdir("data/faces").catch(() => [] as string[]);
if (faces.some((f) => f.endsWith(".jpg"))) {
  await cp("data/faces", `${OUT}/static/faces`, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
  console.log(`Copied ${faces.filter((f) => f.endsWith(".jpg")).length} face photos`);
} else console.log("No face photos installed: Street Patrol photo mode will be unavailable on this build.");
