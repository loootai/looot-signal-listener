import { createHash } from "node:crypto";

export type Obj = Record<string, unknown>;

/** Narrows to a plain object, or an empty one. */
export const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/** First non-empty string (numbers become text) among the candidates, or null. */
export function str(...vs: unknown[]): string | null {
  for (const v of vs) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** First finite number among the candidates, or 0. */
export function num(...vs: unknown[]): number {
  for (const v of vs) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/** Reads a dotted path such as "data.items" out of a value. */
export function at(v: unknown, path: string): unknown {
  let cur: unknown = v;
  for (const part of path.split(".")) {
    if (part === "") continue;
    cur = obj(cur)[part];
  }
  return cur;
}

/** The rows of a provider answer: the first array of objects under the given keys, looking into `data` and `output` too. */
export function rowsOf(raw: unknown, keys: string[]): Obj[] {
  if (Array.isArray(raw)) return raw.filter((r) => r && typeof r === "object").map(obj);
  const o = obj(raw);
  for (const k of keys) if (Array.isArray(o[k])) return (o[k] as unknown[]).map(obj);
  for (const wrap of ["data", "output", "result"]) {
    const inner = o[wrap];
    if (Array.isArray(inner)) return inner.map(obj);
    if (inner && typeof inner === "object") {
      const found = rowsOf(inner, keys);
      if (found.length > 0) return found;
    }
  }
  return [];
}

/** Short stable hash used for fingerprints and idempotency keys. */
export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

/** Host of a URL or bare domain, lower case and without www, or null. */
export function hostOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  try {
    const h = new URL(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

/** A date, epoch seconds or epoch millis as ISO text. "3 days ago" works given `now`. null when unreadable. */
export function toIso(v: unknown, now: Date): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v !== "string" || v.trim() === "") return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) return toIso(Number(s), now);
  const rel = /^(\d+)\s*(minute|hour|day|week|month)s?\s+ago$/i.exec(s);
  if (rel) {
    const unit: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };
    return new Date(now.getTime() - Number(rel[1]) * (unit[rel[2].toLowerCase()] ?? 0)).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lower-cased URL without tracking params, hash or trailing slash, so one page has one fingerprint. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|s$|t$)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    const host = u.hostname.replace(/^(www|old|m|mobile)\./, "").replace(/^twitter\.com$/, "x.com").toLowerCase();
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** HTML tags removed, entities for the common cases decoded, whitespace collapsed, clipped to `limit`. */
export function cleanText(s: unknown, limit = 2000): string {
  if (typeof s !== "string") return "";
  const t = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > limit ? `${t.slice(0, limit - 3)}...` : t;
}

/** Money is integer micro-dollars everywhere. Dollars (number or numeric text) to micros. */
export function toMicros(usd: unknown): number {
  const n = typeof usd === "number" ? usd : typeof usd === "string" && usd !== "" ? Number(usd) : NaN;
  return Number.isFinite(n) ? Math.round(n * 1_000_000) : 0;
}

/** Micros as dollars: five decimals under one cent, four under one dollar, two from one dollar up. */
export function usd(micros: number): string {
  const v = micros / 1_000_000;
  if (micros === 0) return "$0.00";
  return `$${v.toFixed(Math.abs(v) < 0.01 ? 5 : Math.abs(v) < 1 ? 4 : 2)}`;
}

/** Whole-word, case-insensitive match of a phrase in text. */
export function hasPhrase(text: string, phrase: string): boolean {
  const p = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${p}(?![a-z0-9])`, "i").test(text);
}
