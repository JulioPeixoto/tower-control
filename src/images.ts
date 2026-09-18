// Turns an image path used by the games ("/faces/x.jpg") into a data URL a vision model can
// read. The CLI reads the file from data/; the browser fetches it from the site.
export type ImageLoader = (path: string) => Promise<string>;

const fromDisk: ImageLoader = async (path) => {
  const bun = (globalThis as { Bun?: typeof Bun }).Bun;
  if (!bun) throw new Error("No image loader set for this environment.");
  const file = bun.file(`data${path}`);
  if (!(await file.exists())) throw new Error(`Image not found: data${path}. Run \`bun run faces\` first.`);
  return `data:${file.type || "image/jpeg"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
};

let loader: ImageLoader = fromDisk;
const cache = new Map<string, Promise<string>>();

export function setImageLoader(l: ImageLoader): void {
  loader = l;
  cache.clear();
}

export function loadImage(path: string): Promise<string> {
  let hit = cache.get(path);
  if (!hit) {
    hit = loader(path);
    hit.catch(() => cache.delete(path));
    cache.set(path, hit);
  }
  return hit;
}
