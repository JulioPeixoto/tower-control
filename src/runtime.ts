// Small helpers that work the same in Bun, Node (Vercel functions) and the browser.

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An environment variable, or undefined where there is no `process` (the browser). */
export function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}
