// In the browser, images a vision model should see are fetched from this site and sent as
// data URLs through the proxy (OpenRouter cannot fetch pages from a local or private site).
import { setImageLoader } from "../../src/images";

setImageLoader(async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Image not available: ${path}. Photos are installed with \`bun run faces\`.`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
});
