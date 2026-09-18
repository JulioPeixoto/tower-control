import type { RunRecord } from "../../src/runs";

/** A link that saves the finished run as JSON (what the CLI writes to runs/). */
export function downloadLink(record: RunRecord): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "download";
  const stamp = record.savedAt.replace(/[:.]/g, "-").slice(0, 19);
  a.download = `${record.name}-${stamp}.json`;
  a.href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
  a.textContent = "Download the run (JSON)";
  return a;
}
