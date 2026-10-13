import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostOf } from "./util.ts";

/** Where a missing logo is fetched from. Google's favicon service returns a PNG for most domains. */
export const LOGO_URL = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

const MAX_BYTES = 64_000;

/** True when the bytes start with a PNG, JPEG, GIF, WebP or ICO signature. Anything else (an HTML error page) is not cached. */
export function isImage(b: Uint8Array): boolean {
  const h = [...b.slice(0, 12)];
  const starts = (sig: number[], at = 0) => sig.every((x, i) => h[at + i] === x);
  return starts([0x89, 0x50, 0x4e, 0x47]) || starts([0xff, 0xd8, 0xff]) || starts([0x47, 0x49, 0x46]) || (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) || starts([0, 0, 1, 0]);
}

const MIME: Array<[number[], string]> = [
  [[0x89, 0x50], "image/png"],
  [[0xff, 0xd8], "image/jpeg"],
  [[0x47, 0x49], "image/gif"],
  [[0x52, 0x49], "image/webp"],
  [[0, 0], "image/x-icon"],
];
const mimeOf = (b: Uint8Array) => MIME.find(([sig]) => sig.every((x, i) => b[i] === x))?.[1] ?? "image/png";

/**
 * Logos for the given domains as data URIs, keyed by domain, for the HTML report.
 * Reads `<dir>/<domain>.png` first. With `online`, fetches a missing one from LOGO_URL and caches it there.
 * A domain with no logo is left out; the report renders without it.
 */
export async function loadLogos(domains: Array<string | null | undefined>, dir: string, opts: { online?: boolean; fetch?: typeof fetch } = {}): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const f = opts.fetch ?? fetch;
  for (const d of new Set(domains.map((x) => hostOf(x)).filter((x): x is string => Boolean(x)))) {
    const file = join(dir, `${d}.png`);
    let bytes: Uint8Array | null = existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    if (!bytes && opts.online) {
      try {
        const res = await f(LOGO_URL(d), { headers: { "User-Agent": "looot-signal-listener/0.1" } });
        const b = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        if (b && b.length > 0 && b.length <= MAX_BYTES && isImage(b)) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, b);
          bytes = b;
        }
      } catch {
        bytes = null;
      }
    }
    if (bytes && isImage(bytes)) out[d] = `data:${mimeOf(bytes)};base64,${Buffer.from(bytes).toString("base64")}`;
  }
  return out;
}
