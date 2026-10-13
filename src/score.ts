import type { Config, Kind, Reason, Signal } from "./types.ts";
import { hasPhrase, hostOf } from "./util.ts";

/** Points a signal gets for its type alone. A company event is worth more than an anonymous post until the post shows pain or intent. */
export const KIND_BASE: Record<Kind, number> = { funding: 30, leadership: 25, tech_change: 20, hiring: 20, website_change: 15, news: 10, intent: 0 };

function table(text: string, rules: Record<string, number>, cap: number, label: string): Reason[] {
  const hits = Object.entries(rules).filter(([p]) => hasPhrase(text, p));
  if (hits.length === 0) return [];
  const raw = hits.reduce((s, [, w]) => s + w, 0);
  const points = raw > 0 ? Math.min(cap, raw) : Math.max(-cap, raw);
  return [{ points, why: `${label}: ${hits.map(([p]) => `"${p}"`).join(", ")}` }];
}

/** Scores one signal 0 to 100 and says why, one reason per rule that fired. Pure and free. */
export function scoreSignal(s: Signal, c: Config, now: Date): { score: number; reasons: Reason[] } {
  const text = `${s.title} ${s.text} ${s.company ?? ""}`.toLowerCase();
  const reasons: Reason[] = [];
  if (KIND_BASE[s.kind]) reasons.push({ points: KIND_BASE[s.kind], why: `${s.kind.replace("_", " ")} signal` });

  reasons.push(...table(text, c.rules.pain, 40, "pain"));
  reasons.push(...table(text, c.rules.intent, 30, "intent"));
  reasons.push(...table(text, c.rules.negative, 40, "negative"));

  const persona = c.icp.personaWords.filter((w) => hasPhrase(text, w));
  if (persona.length) reasons.push({ points: Math.min(12, persona.length * 4), why: `fits your buyer: ${persona.join(", ")}` });

  const accountHit = c.accounts.list.find((a) => (s.domain && hostOf(a.domain) === s.domain) || (s.company && s.company.toLowerCase() === a.name.toLowerCase()));
  if (accountHit) reasons.push({ points: 15, why: `on your account list: ${accountHit.name}` });

  if (s.kind === "tech_change") {
    const added = s.facts?.added ?? [];
    const removed = s.facts?.removed ?? [];
    const lc = (xs: string[]) => xs.map((x) => x.toLowerCase());
    const compAdded = added.filter((t) => lc(c.accounts.competitorTech).some((x) => t.includes(x)));
    const compRemoved = removed.filter((t) => lc(c.accounts.competitorTech).some((x) => t.includes(x)));
    const watchAdded = added.filter((t) => lc(c.accounts.watchTech).some((x) => t.includes(x)));
    if (compRemoved.length) reasons.push({ points: 25, why: `dropped competitor tech: ${compRemoved.join(", ")}` });
    if (compAdded.length) reasons.push({ points: 15, why: `added competitor tech: ${compAdded.join(", ")}` });
    if (watchAdded.length) reasons.push({ points: 10, why: `added tech you work with: ${watchAdded.join(", ")}` });
  }

  if (s.kind === "website_change") {
    const lines = (s.facts?.addedLines ?? []).join(" ").toLowerCase();
    const kws = c.accounts.pageKeywords.filter((k) => hasPhrase(lines, k));
    if (kws.length) reasons.push({ points: Math.min(20, kws.length * 8), why: `new text on the page mentions: ${kws.join(", ")}` });
  }

  if (s.kind === "intent" && /\?/.test(`${s.title} ${s.text}`)) reasons.push({ points: 5, why: "asks a question" });
  if (s.engagement >= 10) reasons.push({ points: Math.min(10, Math.floor(Math.log2(s.engagement))), why: `${s.engagement} likes and replies` });

  if (s.publishedAt) {
    const ageDays = (now.getTime() - new Date(s.publishedAt).getTime()) / 86_400_000;
    if (ageDays <= 2) reasons.push({ points: 5, why: "posted in the last 2 days" });
    else if (ageDays > c.lookbackDays * 2) reasons.push({ points: -10, why: `older than ${c.lookbackDays * 2} days` });
  }

  const sum = reasons.reduce((t, r) => t + r.points, 0);
  return { score: Math.max(0, Math.min(100, sum)), reasons };
}

export interface AccountRollup {
  key: string;
  company: string;
  domain: string | null;
  score: number;
  kinds: Kind[];
  signals: number;
  top: Signal;
}

/**
 * Groups company-level signals by domain (or company name) and scores the account.
 * Two different kinds of signal at one company in one window beat either alone: +10 per extra kind.
 */
export function rollupAccounts(signals: Signal[]): AccountRollup[] {
  const groups = new Map<string, Signal[]>();
  for (const s of signals) {
    if (s.kind === "intent") continue;
    const key = s.domain ?? s.company?.toLowerCase().trim();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const kinds = [...new Set(list.map((s) => s.kind))];
      const score = Math.min(100, (sorted[0].score ?? 0) + (kinds.length - 1) * 10);
      return { key, company: sorted.find((s) => s.company)?.company ?? key, domain: sorted.find((s) => s.domain)?.domain ?? null, score, kinds, signals: list.length, top: sorted[0] };
    })
    .sort((a, b) => b.score - a.score);
}
