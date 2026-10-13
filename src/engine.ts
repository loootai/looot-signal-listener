import { LoootError, publicPrice, type Runner } from "./looot.ts";
import { rollupAccounts, scoreSignal, type AccountRollup } from "./score.ts";
import { idempotencyKey, pageLines, planCalls, PRICES_AS_OF, techNames, type Draft, type PlannedCall } from "./sources.ts";
import type { State } from "./state.ts";
import type { Config, Signal } from "./types.ts";
import { canonicalUrl, hash, toMicros, usd } from "./util.ts";

export interface Prices {
  /** endpointId -> micros per unit. */
  micros: Record<string, number>;
  source: "catalog" | "fallback";
  asOf: string;
}

/** Reads live prices for the endpoints the plan uses from the free public catalog. Falls back to the dated prices per endpoint. */
export async function loadPrices(calls: PlannedCall[], opts: { fetch?: typeof fetch; baseUrl?: string; offline?: boolean } = {}): Promise<Prices> {
  const micros: Record<string, number> = {};
  for (const c of calls) if (c.endpointId) micros[c.endpointId] = c.fallbackMicros;
  if (opts.offline) return { micros, source: "fallback", asOf: PRICES_AS_OF };
  let allLive = true;
  await Promise.all(
    Object.keys(micros).map(async (id) => {
      const p = await publicPrice(id, opts);
      if (p) micros[id] = p.micros;
      else allLive = false;
    }),
  );
  return { micros, source: allLive ? "catalog" : "fallback", asOf: allLive ? new Date().toISOString() : PRICES_AS_OF };
}

/** Worst-case cost of one call in micros. */
export const callMax = (c: PlannedCall, p: Prices): number => (c.endpointId ? (p.micros[c.endpointId] ?? c.fallbackMicros) * c.maxUnits : 0);

export interface Quote {
  calls: number;
  paidCalls: number;
  maxMicros: number;
  bySource: Record<string, { calls: number; maxMicros: number }>;
  unpriced: string[];
}

/** What a run would cost at most. Makes no paid call. */
export function quote(calls: PlannedCall[], p: Prices): Quote {
  const bySource: Quote["bySource"] = {};
  let max = 0;
  const unpriced: string[] = [];
  for (const c of calls) {
    const m = callMax(c, p);
    max += m;
    const row = (bySource[c.source] ??= { calls: 0, maxMicros: 0 });
    row.calls += 1;
    row.maxMicros += m;
    if (c.endpointId && !(p.micros[c.endpointId] > 0)) unpriced.push(c.endpointId);
  }
  return { calls: calls.length, paidCalls: calls.filter((c) => c.endpointId).length, maxMicros: max, bySource, unpriced: [...new Set(unpriced)] };
}

export interface RunResult {
  at: string;
  calls: number;
  costMicros: number;
  log: string[];
  /** Every signal found this run that cleared minScore, best first. `isNew` is false for ones seen in earlier runs. */
  signals: Array<Signal & { isNew: boolean }>;
  accounts: AccountRollup[];
}

/** Fingerprint shared across sources: the canonical URL when there is one, otherwise the source and title. */
export function fingerprint(d: Draft): string {
  if (d.kind === "tech_change") return hash(`tech|${d.domain}|${(d.facts?.added ?? []).join(",")}|${(d.facts?.removed ?? []).join(",")}`);
  if (d.kind === "website_change") return hash(`page|${d.query}|${(d.facts?.addedLines ?? []).join("\n")}`);
  if (d.url) return hash(canonicalUrl(d.url));
  return hash(`${d.source}|${d.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`);
}

/** Compares this run's tech list or page lines with the last snapshot. Returns a change signal, or null for a first look or no change. */
export function diffSnapshot(call: PlannedCall, raw: unknown, state: State, now: Date, log: string[]): Draft | null {
  const key = call.snapshotKey!;
  const prev = state.snapshots[key];
  if (key.startsWith("tech:")) {
    const domain = key.slice(5);
    const items = techNames(raw);
    if (items.length === 0) {
      log.push(`techstack ${domain}: no technologies in the answer, snapshot kept`);
      return null;
    }
    state.snapshots[key] = { at: now.toISOString(), items };
    if (!prev) {
      log.push(`techstack ${domain}: first look, ${items.length} technologies stored as the baseline`);
      return null;
    }
    const added = items.filter((t) => !prev.items.includes(t));
    const removed = prev.items.filter((t) => !items.includes(t));
    if (added.length === 0 && removed.length === 0) return null;
    const parts = [added.length ? `added ${added.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""].filter(Boolean);
    return { kind: "tech_change", source: "techstack", query: domain, title: `${domain} ${parts.join("; ")}`, text: `Tech stack change since ${prev.at.slice(0, 10)}: ${parts.join("; ")}`, url: `https://${domain}`, author: null, company: null, domain, publishedAt: now.toISOString(), engagement: 0, facts: { added, removed } };
  }
  const url = call.label;
  const lines = pageLines(raw);
  if (lines.length === 0) {
    log.push(`website ${url}: empty page, snapshot kept`);
    return null;
  }
  const hashes = lines.map((l) => hash(l).slice(0, 12));
  state.snapshots[key] = { at: now.toISOString(), items: [...new Set(hashes)].slice(0, 5000) };
  if (!prev) {
    log.push(`website ${url}: first look, ${lines.length} lines stored as the baseline`);
    return null;
  }
  const old = new Set(prev.items);
  const addedLines = lines.filter((_, i) => !old.has(hashes[i]));
  if (addedLines.length === 0) return null;
  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  return { kind: "website_change", source: "website", query: url, title: `${url} changed: ${addedLines.length} new line${addedLines.length === 1 ? "" : "s"}`, text: addedLines.slice(0, 8).join(" | "), url, author: null, company: null, domain: host, publishedAt: now.toISOString(), engagement: 0, facts: { addedLines: addedLines.slice(0, 40) } };
}

export interface RunOptions {
  config: Config;
  state: State;
  /** null when there is no LOOOT_TOKEN: only free sources run. */
  client: Runner | null;
  prices: Prices;
  fetch?: typeof fetch;
  now?: Date;
}

/** One listening pass: plan, run every call inside the budget, diff snapshots, dedupe, score. Mutates `state`. */
export async function runOnce(o: RunOptions): Promise<RunResult> {
  const now = o.now ?? new Date();
  const f = o.fetch ?? fetch;
  const c = o.config;
  const calls = planCalls(c, now);
  const budget = Math.round(c.budgetUsd * 1_000_000);
  const log: string[] = [];
  const drafts: Draft[] = [];
  let spent = 0;
  let made = 0;
  let paidStopped: string | null = o.client ? null : "no LOOOT_TOKEN set, paid sources skipped";
  if (paidStopped) log.push(paidStopped);

  for (const call of calls) {
    try {
      let raw: unknown;
      if (!call.endpointId) {
        const res = await f(call.freeUrl!, { headers: { "User-Agent": "looot-signal-listener/0.1" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        raw = await res.json();
        made += 1;
      } else {
        if (paidStopped || !o.client) continue;
        const max = callMax(call, o.prices);
        if (spent + max > budget) {
          log.push(`${call.source} "${call.label}": skipped, would pass the ${usd(budget)} budget (spent ${usd(spent)})`);
          continue;
        }
        const run = await o.client.runAndWait(call.endpointId, call.input, idempotencyKey(call, now));
        made += 1;
        spent += run.actualCost !== undefined && run.actualCost !== null ? toMicros(run.actualCost) : max;
        if (run.status !== "completed") {
          log.push(`${call.source} "${call.label}": ${run.status}${run.error?.message ? `, ${run.error.message}` : ""}`);
          continue;
        }
        raw = run.result;
      }
      if (call.snapshotKey) {
        const d = diffSnapshot(call, raw, o.state, now, log);
        if (d) drafts.push(d);
        continue;
      }
      const rows = call.parse(raw, now);
      drafts.push(...rows);
      log.push(`${call.source} "${call.label}": ${rows.length} found`);
    } catch (e) {
      if (e instanceof LoootError && (e.status === 401 || e.status === 402)) {
        paidStopped = e.status === 401 ? "looot rejected the token (401), paid sources stopped" : "looot balance is empty (402), paid sources stopped";
        log.push(paidStopped);
        continue;
      }
      log.push(`${call.source} "${call.label}": error, ${(e as Error).message}`);
    }
  }

  const byId = new Map<string, Signal>();
  for (const d of drafts) {
    const id = fingerprint(d);
    if (!byId.has(id)) byId.set(id, { ...d, id });
  }
  const signals: RunResult["signals"] = [];
  for (const s of byId.values()) {
    const { score, reasons } = scoreSignal(s, c, now);
    if (score < c.minScore) continue;
    const isNew = !o.state.seen[s.id];
    if (isNew) o.state.seen[s.id] = now.toISOString();
    signals.push({ ...s, score, reasons, isNew });
  }
  signals.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(b.isNew) - Number(a.isNew));
  const newCount = signals.filter((s) => s.isNew).length;
  o.state.runs.push({ at: now.toISOString(), calls: made, costMicros: spent, found: signals.length, new: newCount });
  log.push(`done: ${made} calls, ${usd(spent)} spent, ${byId.size} unique, ${signals.length} at or above score ${c.minScore}, ${newCount} new`);
  return { at: now.toISOString(), calls: made, costMicros: spent, log, signals, accounts: rollupAccounts(signals) };
}
