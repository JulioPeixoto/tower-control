// Aggregates saved arena runs per game, strategy/state and controller.
//   bun scripts/summarize.ts [game] [--since 2026-09-18T04:00]
import { readdir } from "node:fs/promises";

const args = Bun.argv.slice(2);
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]!) : null;
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--since");

interface Lane {
  label: string;
  kind: string;
  score: number;
  metrics: Record<string, number>;
  stats: { calls: number; errors: number; p50Ms: number | null; costUsd: number };
}
interface Run {
  game: string;
  config: { level: number; mode: string; options: Record<string, string>; seed: number };
  savedAt: string;
  stopped: boolean;
  lanes: Lane[];
}

const KEY_METRICS: Record<string, [string, (m: Record<string, number>) => string][]> = {
  dispatch: [
    ["correct", (m) => `${m.correct}/${m.answered}`],
    ["missed", (m) => String(m.missed)],
    ["wrongUnit", (m) => String(m.wrongService)],
    ["wasted", (m) => String(m.wasted)],
    ["fooledPrank", (m) => String(m.fooledByPrank)],
    ["fooledInject", (m) => String(m.fooledByInjection)],
    ["brier", (m) => (m.brier ?? 0).toFixed(3)],
  ],
  sorting: [
    ["correct", (m) => `${m.correct}/${m.delivered}`],
    ["accuracy", (m) => `${Math.round((m.accuracy ?? 0) * 100)}%`],
    ["dropped", (m) => String((m.dropped ?? 0) + (m.rejected ?? 0))],
    ["attrAcc", (m) => (m.attrAsked ? `${Math.round(((m.attrCorrect ?? 0) / m.attrAsked) * 100)}%` : "-")],
  ],
  highway: [
    ["crashes", (m) => String(m.crashes)],
    ["coins", (m) => `${m.coins}/${m.coinsTotal}`],
    ["moves", (m) => String(m.moves)],
  ],
};

for (const game of (await readdir("runs", { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)) {
  if (only && game !== only) continue;
  const runs: Run[] = [];
  for (const f of await readdir(`runs/${game}`)) {
    if (!f.endsWith(".json")) continue;
    const run = (await Bun.file(`runs/${game}/${f}`).json()) as Run;
    if (run.stopped || (since && new Date(run.savedAt) < since)) continue;
    runs.push(run);
  }
  if (!runs.length) continue;

  // Group by setting (level, mode, options) then controller.
  const groups = new Map<string, Map<string, { lanes: Lane[] }>>();
  for (const r of runs) {
    const setting = `L${r.config.level} ${r.config.mode} ${Object.entries(r.config.options ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")}`.trim();
    const g = groups.get(setting) ?? new Map();
    for (const l of r.lanes) {
      const e = g.get(l.label) ?? { lanes: [] };
      e.lanes.push(l);
      g.set(l.label, e);
    }
    groups.set(setting, g);
  }

  for (const [setting, byController] of groups) {
    console.log(`\n## ${game} · ${setting}`);
    const rows = [...byController.entries()].map(([label, { lanes }]) => {
      const sum = (f: (l: Lane) => number) => lanes.reduce((s, l) => s + f(l), 0);
      const merged: Record<string, number> = {};
      for (const l of lanes) for (const [k, v] of Object.entries(l.metrics)) merged[k] = (merged[k] ?? 0) + v;
      // Averages for ratio metrics.
      for (const k of ["brier", "accuracy", "progress", "meanStaleS"]) if (k in merged) merged[k]! /= lanes.length;
      const p50s = lanes.map((l) => l.stats.p50Ms).filter((x): x is number => x !== null);
      const row: Record<string, string | number> = {
        controller: label,
        runs: lanes.length,
        score: Math.round(sum((l) => l.score) / lanes.length),
      };
      for (const [name, fn] of KEY_METRICS[game] ?? []) row[name] = fn(merged);
      row.p50ms = p50s.length ? Math.round(p50s.reduce((a, b) => a + b, 0) / p50s.length) : "-";
      row.errors = sum((l) => l.stats.errors);
      row.costUsd = Number(sum((l) => l.stats.costUsd).toFixed(4));
      return row;
    });
    console.table(rows);
  }
}
