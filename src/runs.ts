// A finished (or stopped) match as saved for analysis.
export interface RunRecord {
  /** Short name for the file, e.g. "sorting-L3-s1-turn". */
  name: string;
  game: string;
  config: unknown;
  level?: string;
  savedAt: string;
  stopped: boolean;
  simTime: number;
  lanes: {
    id: string;
    label: string;
    kind: string;
    model?: string;
    score: number;
    metrics: unknown;
    stats: unknown;
    decisions: unknown[];
  }[];
}

/** Writes a run under `runs/` (Tower Control) or `runs/<game>/`. CLI only: uses the file system. */
export async function saveRun(run: RunRecord, dir = "runs"): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  const folder = run.game === "tower" ? dir : `${dir}/${run.game}`;
  await mkdir(folder, { recursive: true });
  const stamp = run.savedAt.replace(/[:.]/g, "-").slice(0, 23);
  const file = `${folder}/${stamp}-${run.name.replace(/^[a-z]+-/, "")}.json`;
  await Bun.write(file, JSON.stringify(run, null, 2));
  return file;
}
