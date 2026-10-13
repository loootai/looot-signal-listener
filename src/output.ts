import type { RunResult } from "./engine.ts";
import type { Config, Signal } from "./types.ts";
import { usd } from "./util.ts";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

/** The top reasons of a signal as one short line, biggest first. */
export function reasonLine(s: Signal, n = 3): string {
  return [...(s.reasons ?? [])]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, n)
    .map((r) => `${r.points > 0 ? "+" : ""}${r.points} ${r.why}`)
    .join("; ");
}

/** Plain-text table for the terminal: score, kind, source, who, title, then the reasons and the link. */
export function table(r: RunResult, limit = 25, onlyNew = false): string {
  const rows = r.signals.filter((s) => !onlyNew || s.isNew).slice(0, limit);
  const out: string[] = [];
  out.push(`${"SCORE".padEnd(6)}${"NEW".padEnd(5)}${"KIND".padEnd(15)}${"SOURCE".padEnd(14)}${"WHO".padEnd(22)}TITLE`);
  for (const s of rows) {
    out.push(`${String(s.score).padEnd(6)}${(s.isNew ? "yes" : "").padEnd(5)}${clip(s.kind, 14)} ${clip(s.source, 13)} ${clip((s.kind === "intent" ? s.author ?? s.company : s.company ?? s.author) ?? "", 21)} ${clip(s.title, 70).trimEnd()}`);
    out.push(`      why: ${reasonLine(s)}`);
    if (s.url) out.push(`      ${s.url}`);
  }
  if (rows.length === 0) out.push("(nothing at or above the minimum score)");
  if (r.accounts.length > 0) {
    out.push("", "ACCOUNTS (company-level signals grouped)");
    for (const a of r.accounts.slice(0, 10)) out.push(`${String(a.score).padEnd(6)}${clip(a.company, 28)} ${a.signals} signal${a.signals === 1 ? "" : "s"}: ${a.kinds.join(", ")}`);
  }
  out.push("", `${r.calls} calls, ${usd(r.costMicros)} spent, ${r.signals.length} signals, ${r.signals.filter((s) => s.isNew).length} new`);
  return out.join("\n");
}

const CSV_FIELDS = ["score", "isNew", "kind", "source", "company", "domain", "author", "title", "url", "publishedAt", "reasons"] as const;

/** CSV of the signals, one row each, reasons joined with "; ". */
export function csv(r: RunResult): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_FIELDS.join(",")];
  for (const s of r.signals) lines.push(CSV_FIELDS.map((f) => esc(f === "reasons" ? reasonLine(s, 10) : (s as unknown as Record<string, unknown>)[f])).join(","));
  return `${lines.join("\n")}\n`;
}

/** Signals worth a ping: new this run and at or above notify.minScore. */
export const toNotify = (r: RunResult, c: Config) => r.signals.filter((s) => s.isNew && (s.score ?? 0) >= c.notify.minScore);

/** Slack incoming-webhook body (mrkdwn text). */
export function slackPayload(r: RunResult, c: Config): { text: string } {
  const hot = toNotify(r, c).slice(0, 15);
  const lines = [`*${hot.length} new signal${hot.length === 1 ? "" : "s"}* at score ${c.notify.minScore}+${c.product ? ` for ${c.product}` : ""}`];
  for (const s of hot) lines.push(`• *${s.score}* ${s.kind} · ${s.company ?? s.author ?? s.source}: ${s.url ? `<${s.url}|${s.title.replace(/[<>|]/g, "")}>` : s.title}\n   _${reasonLine(s, 2)}_`);
  lines.push(`${r.calls} calls, ${usd(r.costMicros)} spent`);
  return { text: lines.join("\n") };
}

/** Generic webhook body: run summary plus the signals to notify about, as JSON. */
export function webhookPayload(r: RunResult, c: Config) {
  return { at: r.at, product: c.product, calls: r.calls, costUsd: r.costMicros / 1_000_000, signals: toNotify(r, c), accounts: r.accounts.slice(0, 20).map(({ top, ...a }) => ({ ...a, topSignal: top.title })) };
}

/** The opening line of a draft, by signal kind. These are starting points to edit, not messages to send as is. */
function opener(s: Signal): string {
  const who = s.company ?? "your team";
  switch (s.kind) {
    case "funding":
      return `Congrats on the round. ${s.title}.`;
    case "hiring":
      return `Saw ${who} is hiring (${s.title.replace(/^.* is hiring: /, "")}). Teams usually hire for that when the work has outgrown the current setup.`;
    case "leadership":
      return `Saw the news: "${s.title}". New leaders often review the tools in their first 90 days.`;
    case "tech_change":
      return `Noticed ${s.domain ?? who} ${s.title.replace(`${s.domain} `, "")}.`;
    case "website_change":
      return `Noticed a change on ${s.url}: "${(s.facts?.addedLines ?? [])[0] ?? ""}".`;
    case "news":
      return `Read "${s.title}".`;
    default:
      return `Saw your post${s.source ? ` on ${s.source}` : ""}: "${s.title.slice(0, 120)}".`;
  }
}

/** Markdown file of email drafts for signals worth a ping. Nothing is sent. */
export function emailDrafts(r: RunResult, c: Config): string {
  const hot = toNotify(r, c);
  const out = [`# Email drafts, ${r.at.slice(0, 10)}`, "", `Drafts for ${hot.length} new signal${hot.length === 1 ? "" : "s"} at score ${c.notify.minScore}+. Edit before you send. Check each platform's rules and local law (GDPR, CAN-SPAM) first.`, ""];
  for (const s of hot) {
    out.push(`## ${s.company ?? s.author ?? s.source} (score ${s.score})`, "", `Signal: ${s.kind}, ${s.url ?? "no link"}`, `Why now: ${reasonLine(s, 3)}`, "", "```", `Subject: ${s.kind === "intent" ? "your question" : `${s.company ?? "quick question"}`}`, "", "Hi {first name},", "", opener(s), "", `${c.product || "We help teams like yours with this"}. Worth a 15-minute call to compare notes?`, "", "{your name}", "```", "");
  }
  return out.join("\n");
}

/** Posts to Slack and the generic webhook when their env vars are set and there is something to send. Returns what it did. */
export async function notify(r: RunResult, c: Config, env: Record<string, string | undefined>, f: typeof fetch = fetch): Promise<string[]> {
  const done: string[] = [];
  if (toNotify(r, c).length === 0) return ["notify: nothing new at or above notify.minScore"];
  const targets: Array<[string, string | undefined, unknown]> = [
    ["slack", env[c.notify.slackWebhookEnv], slackPayload(r, c)],
    ["webhook", env[c.notify.webhookEnv], webhookPayload(r, c)],
  ];
  for (const [name, url, body] of targets) {
    if (!url) continue;
    try {
      const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      done.push(`notify: ${name} ${res.ok ? "sent" : `failed, HTTP ${res.status}`}`);
    } catch (e) {
      done.push(`notify: ${name} failed, ${(e as Error).message}`);
    }
  }
  if (done.length === 0) done.push(`notify: no ${c.notify.slackWebhookEnv} or ${c.notify.webhookEnv} set, skipped`);
  return done;
}
