// Spaces calls per key (model) to stay under a requests-per-minute cap.
// New OpenRouter accounts are limited to 20 requests per minute per model.
const nextSlot = new Map<string, number>();

export const DEFAULT_RPM = Number(process.env.OPENROUTER_RPM ?? 20);

/** Resolves when the caller may send the next request for `key`. */
export async function acquire(key: string, rpm = DEFAULT_RPM): Promise<void> {
  if (!Number.isFinite(rpm) || rpm <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(key) ?? 0);
  nextSlot.set(key, slot + 60_000 / rpm);
  if (slot > now) await Bun.sleep(slot - now);
}
