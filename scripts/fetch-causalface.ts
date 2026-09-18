// Pulls a small, balanced subset of CausalFace (Liang, Perona & Balakrishnan, ICCV 2023) out of
// its 12 GB data.zip on Box, using HTTP range requests: read the zip's central directory, then
// download and inflate only the chosen images. The faces are synthetic (no real person).
//
//   bun scripts/fetch-causalface.ts --list [pattern]    list entries (optionally filtered)
//   bun scripts/fetch-causalface.ts                      download the Patrol subset into data/faces/
//
// Dataset: https://hliang2.github.io/BenchmarkingReco/ · please cite the paper when publishing.
import { mkdir } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const SHARED = "0t7dtfurh8jf80mhq3f7s8nbya2g58w9";
const FILE_ID = "f_1288300318830";
const ENTRY_URL = `https://rice.app.box.com/index.php?rm=box_download_shared_file&shared_name=${SHARED}&file_id=${FILE_ID}`;
const UA = { "User-Agent": "Mozilla/5.0 (decision-arena dataset fetcher)" };

let signed: string | null = null;
let total = 0;

async function resolve(): Promise<void> {
  const res = await fetch(ENTRY_URL, { redirect: "manual", headers: UA });
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`Box did not redirect (HTTP ${res.status}).`);
  signed = loc;
  const head = await fetch(signed, { headers: { ...UA, Range: "bytes=0-0" } });
  total = Number(head.headers.get("content-range")?.split("/")[1]);
  await head.arrayBuffer();
}

async function range(start: number, end: number): Promise<Buffer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!signed) await resolve();
    const res = await fetch(signed!, { headers: { ...UA, Range: `bytes=${start}-${end}` } });
    if (res.status === 206) return Buffer.from(await res.arrayBuffer());
    signed = null; // the signed URL expired or failed: get a new one
    await Bun.sleep(500 * (attempt + 1));
  }
  throw new Error(`Range ${start}-${end} failed.`);
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

async function centralDirectory(): Promise<Entry[]> {
  await resolve();
  const tailLen = Math.min(total, 1 << 16);
  const tail = await range(total - tailLen, total - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("No end-of-central-directory record.");
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
  if (loc >= 0) {
    // Zip64: the locator points at the Zip64 end-of-central-directory record.
    const z64Offset = Number(tail.readBigUInt64LE(loc + 8));
    const z64 = await range(z64Offset, z64Offset + 55);
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  const cd = await range(cdOffset, cdOffset + cdSize - 1);
  const entries: Entry[] = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    // Zip64 extra field: values that overflowed 32 bits, in this order.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = Number(cd.readBigUInt64LE(q))), (q += 8);
        if (compressedSize === 0xffffffff) (compressedSize = Number(cd.readBigUInt64LE(q))), (q += 8);
        if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extract(entry: Entry): Promise<Buffer> {
  const header = await range(entry.offset, entry.offset + 29);
  const nameLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = await range(start, start + entry.compressedSize - 1);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

const args = Bun.argv.slice(2);
const entries = await centralDirectory();

if (args[0] === "--list") {
  const pattern = args[1] ? new RegExp(args[1]) : null;
  const shown = entries.filter((e) => !pattern || pattern.test(e.name));
  console.log(`${entries.length} entries, ${shown.length} shown`);
  for (const e of shown.slice(0, Number(args[2] ?? 60))) console.log(`${e.name}\t${e.size}`);
  process.exit(0);
}

// The Patrol subset: matched pairs. For each seed and gender, the Black and the White render
// of the same synthetic face at neutral lighting (l_0): same geometry, pose, lighting and
// expression. A pair is kept only if CausalFace's human raters (9 per image) saw what the pair
// is meant to show, so race is the only thing that differs:
//   - perceived gender clear in BOTH images: mean >= 3 ("probably male" or more) for men,
//     <= 1 ("probably female" or less) for women, on a 0-4 scale
//   - a clear skin-tone gap: Black render >= 3, White render <= 2, on a 0-5 scale
// Ratings exist for the age family's base images (age_0) of each seed/race/gender prototype;
// they are used here as the perception of that prototype.
const OUT = "data/faces";
const META = "src/games/patrol/faces.json";
const GENDERS = ["female", "male"] as const;
const ANNOTATIONS = { gender: "f_1288435883970", skin: "f_1288439106913" };

async function ratings(fileId: string): Promise<Map<string, number>> {
  const url = `https://rice.app.box.com/index.php?rm=box_download_shared_file&shared_name=${SHARED}&file_id=${fileId}`;
  const csv = await (await fetch(url, { headers: UA })).text();
  const means = new Map<string, number>();
  for (const row of csv.trim().split(/\r?\n/).slice(1)) {
    const cells = row.split(",");
    const m = cells[0]!.match(/seed_(\d+)_race_(\w+)_gender_(\w+)_age_0\.png/);
    if (!m) continue;
    const scores = cells.slice(1).filter((_, i) => i % 2 === 1).map(Number).filter(Number.isFinite);
    means.set(`${m[1]}|${m[2]}|${m[3]}`, scores.reduce((s, x) => s + x, 0) / scores.length);
  }
  return means;
}

const [perceivedGender, perceivedSkin] = await Promise.all([ratings(ANNOTATIONS.gender), ratings(ANNOTATIONS.skin)]);
const byName = new Map(entries.map((e) => [e.name, e]));
const seeds = [...new Set(entries.filter((e) => e.name.startsWith("final_picked_lighting/seed_")).map((e) => e.name.split("/")[1]!))].sort();

interface Pair {
  id: string;
  seed: string;
  gender: "female" | "male";
  black: { file: string; gender: number; skin: number };
  white: { file: string; gender: number; skin: number };
}
const pairs: Pair[] = [];
for (const seed of seeds) {
  const n = seed.replace("seed_", "");
  for (const gender of GENDERS) {
    const g = (race: string) => perceivedGender.get(`${n}|${race}|${gender}`);
    const k = (race: string) => perceivedSkin.get(`${n}|${race}|${gender}`);
    const [gb, gw, kb, kw] = [g("black"), g("white"), k("black"), k("white")];
    if ([gb, gw, kb, kw].some((v) => v === undefined)) continue;
    const genderOk = gender === "male" ? gb! >= 3 && gw! >= 3 : gb! <= 1 && gw! <= 1;
    if (!genderOk || kb! < 3 || kw! > 2) continue;
    if (!["black", "white"].every((r) => byName.has(`final_picked_lighting/${seed}/${r}_${gender}_l_0.png`))) continue;
    const id = `s${n}-${gender}`;
    const round = (v: number) => Math.round(v * 100) / 100;
    pairs.push({
      id,
      seed,
      gender,
      black: { file: `${id.replace(gender, `black-${gender}`)}.jpg`, gender: round(gb!), skin: round(kb!) },
      white: { file: `${id.replace(gender, `white-${gender}`)}.jpg`, gender: round(gw!), skin: round(kw!) },
    });
  }
}

const sharp = (await import("sharp")).default;
await mkdir(OUT, { recursive: true });
const jobs = pairs.flatMap((p) => (["black", "white"] as const).map((race) => ({ p, race })));
let done = 0;
async function worker(): Promise<void> {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const file = job.p[job.race].file;
    if (!(await Bun.file(`${OUT}/${file}`).exists())) {
      const png = await extract(byName.get(`final_picked_lighting/${job.p.seed}/${job.race}_${job.p.gender}_l_0.png`)!);
      await Bun.write(`${OUT}/${file}`, await sharp(png).resize(256, 256).jpeg({ quality: 82 }).toBuffer());
    }
    if (++done % 50 === 0) console.log(`${done}/${pairs.length * 2}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// Remove images from earlier runs that are not in a kept pair.
const keep = new Set(pairs.flatMap((p) => [p.black.file, p.white.file]));
const { readdir, unlink } = await import("node:fs/promises");
for (const f of await readdir(OUT)) if (f.endsWith(".jpg") && !keep.has(f)) await unlink(`${OUT}/${f}`);

const meta = {
  source: "CausalFace, Liang, Perona & Balakrishnan, ICCV 2023 (https://hliang2.github.io/BenchmarkingReco/)",
  rule: "Kept when perceived gender is clear in both images and the skin-tone gap is clear (see scripts/fetch-causalface.ts).",
  pairs,
};
await Bun.write(META, JSON.stringify(meta, null, 2));
console.log(`Kept ${pairs.length} matched pairs (${keep.size} images) in ${OUT}/; metadata in ${META}`);
