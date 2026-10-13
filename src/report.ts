import type { Quote, RunResult } from "./engine.ts";
import type { State } from "./state.ts";
import type { Config, Kind, Signal } from "./types.ts";
import { usd } from "./util.ts";

export interface ReportInput {
  result: RunResult;
  config: Config;
  /** The quote for the next run, shown in the "Run now" dialog. */
  quote?: Quote;
  /** Where the quote prices came from, for example "live public catalog". */
  pricesSource?: string;
  /** Earlier runs from the state file, oldest first. */
  runs?: State["runs"];
  /** A pill in the top bar, for example "Demo data" when the page is built from fixtures. */
  label?: string;
}

/** Escapes text for HTML element content and attribute values. */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** An href for http and https URLs only; anything else renders as plain text. */
const safeUrl = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

const KIND_LABEL: Record<Kind, string> = { intent: "Intent", hiring: "Hiring", funding: "Funding", leadership: "Leadership", news: "News", tech_change: "Tech change", website_change: "Page change" };
const KIND_COLOR: Record<Kind, string> = { intent: "#2f6fde", hiring: "#d98a1f", funding: "#12a06a", leadership: "#3b8c8c", news: "#5f6b7a", tech_change: "#7a8b2e", website_change: "#8a5a44" };

const who = (s: Signal) => (s.kind === "intent" ? s.author ?? s.company : s.company ?? s.domain ?? s.author) ?? "";
const kindChip = (k: Kind) => `<span class="kind" style="--k:${KIND_COLOR[k]}">${KIND_LABEL[k]}</span>`;
const scorePill = (n: number | undefined) => `<span class="score${(n ?? 0) >= 60 ? " hot" : ""}">${n ?? 0}</span>`;
const reasonChips = (s: Signal, n = 4) =>
  [...(s.reasons ?? [])]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, n)
    .map((r) => `<span class="reason"><b class="${r.points < 0 ? "neg" : ""}">${r.points > 0 ? "+" : ""}${r.points}</b> ${esc(r.why)}</span>`)
    .join("");
const titleLink = (s: Signal) => {
  const href = safeUrl(s.url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title);
};

/** The before/after lines of a tech or page change: removed in red, added in green. */
function diffLines(s: Signal): string {
  const removed = (s.facts?.removed ?? []).map((t) => `<div class="del">- ${esc(t)}</div>`);
  const added = [...(s.facts?.added ?? []), ...(s.facts?.addedLines ?? [])].map((t) => `<div class="add">+ ${esc(t)}</div>`);
  return removed.length + added.length ? `<div class="diff num">${[...removed, ...added].join("")}</div>` : "";
}

const ICON = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><defs><pattern id="lb" patternUnits="userSpaceOnUse" x="0" y="9" width="32" height="3.027"><rect width="32" height="1.892" fill="#2fc48a"/></pattern></defs><circle cx="5.6" cy="16" r="4.1" fill="none" stroke="#2fc48a" stroke-width="2.6"/><circle cx="16" cy="16" r="5.4" fill="none" stroke="url(#lb)" stroke-width="3.2"/><circle cx="26.4" cy="16" r="4.1" fill="none" stroke="#2fc48a" stroke-width="2.6"/></svg>`;

const NAV = [
  ["leads", "Leads"],
  ["accounts", "Accounts"],
  ["changes", "Changes"],
  ["sources", "Sources"],
  ["costs", "Costs"],
  ["settings", "Settings"],
] as const;

const detailItem = (s: Signal) => `<div class="item">${kindChip(s.kind)}<div class="t">${titleLink(s)}</div>${diffLines(s)}<div class="reasons">${reasonChips(s, 3)}</div></div>`;

/** A static, dependency-free HTML report of one run: leads with reasons, accounts, changes, sources, costs and the config. */
export function renderReport(i: ReportInput): string {
  const { result: r, config: c, quote: q, runs = [] } = i;
  const fresh = r.signals.filter((s) => s.isNew);
  const changes = r.signals.filter((s) => s.kind === "tech_change" || s.kind === "website_change");
  const budget = Math.round(c.budgetUsd * 1e6);
  const spentPct = budget ? Math.min(100, Math.round((r.costMicros / budget) * 100)) : 0;
  const top = r.accounts[0];
  const when = `${r.at.slice(0, 10)} ${r.at.slice(11, 16)} UTC`;
  const runBtn = q ? `<button class="btn" type="button" onclick="document.getElementById('quote').showModal()">Run now <i></i> <b class="num">${usd(q.maxMicros)}</b></button>` : "";

  const leadRows = r.signals
    .map(
      (s) => `<tr${s.isNew ? ' class="new"' : ""}>
<td>${scorePill(s.score)}</td>
<td>${kindChip(s.kind)}</td>
<td><div class="t">${titleLink(s)}${s.isNew ? ' <span class="badge">new</span>' : ""}</div><div class="meta"><span class="num">${esc(s.source)}</span> · ${esc(who(s))}</div><div class="reasons">${reasonChips(s)}</div></td>
</tr>`,
    )
    .join("");

  const accountRows = r.accounts
    .map((a) => `<tr><td>${scorePill(a.score)}</td><td><div class="t">${esc(a.company)}</div><div class="meta num">${esc(a.domain ?? "")}</div></td><td class="r num">${a.signals}</td><td>${a.kinds.map(kindChip).join(" ")}</td></tr>`)
    .join("");

  const topSignals = top ? r.signals.filter((s) => (s.domain && s.domain === top.domain) || (s.company && s.company === top.company)) : [];
  const detail = top
    ? `<aside class="panel detail"><div class="ph"><div><div class="label">Account</div><div class="h2">${esc(top.company)}</div><div class="meta num">${esc(top.domain ?? "")}</div></div>${scorePill(top.score)}</div>
<div class="label pad">What changed since the last run</div>
${topSignals.filter((s) => s.isNew).map(detailItem).join("") || `<div class="empty">Nothing new at this account.</div>`}
${topSignals.some((s) => !s.isNew) ? `<div class="label pad">Seen in earlier runs</div>${topSignals.filter((s) => !s.isNew).map(detailItem).join("")}` : ""}</aside>`
    : "";

  const changeCards = changes.length
    ? changes.map((s) => `<div class="change">${scorePill(s.score)}<div><div>${kindChip(s.kind)} <span class="meta num">${esc(s.domain ?? s.query)}</span></div><div class="t">${titleLink(s)}</div>${diffLines(s)}<div class="reasons">${reasonChips(s, 3)}</div></div></div>`).join("")
    : `<div class="empty">No tech stack or page changes this run. The first run stores a baseline.</div>`;

  const foundBy: Record<string, number> = {};
  for (const s of r.signals) foundBy[s.source] = (foundBy[s.source] ?? 0) + 1;
  const sourceRows = q
    ? Object.entries(q.bySource)
        .map(([src, row]) => `<tr><td class="num">${esc(src)}</td><td class="r num">${row.calls}</td><td class="r num">${row.maxMicros ? usd(row.maxMicros) : "free"}</td><td class="r num">${foundBy[src] ?? 0}</td></tr>`)
        .join("")
    : "";

  const maxRun = Math.max(1, ...runs.map((x) => x.costMicros));
  const runRows = [...runs]
    .reverse()
    .slice(0, 14)
    .map((x) => `<tr><td class="num nw">${esc(x.at.slice(0, 16).replace("T", " "))}</td><td class="r num">${x.calls}</td><td class="r num">${usd(x.costMicros)}</td><td><span class="bar"><span style="width:${Math.round((x.costMicros / maxRun) * 100)}%"></span></span></td><td class="r num">${x.found}</td><td class="r num">${x.new}</td></tr>`)
    .join("");

  const list = (xs: string[]) => (xs.length ? xs.map((x) => `<span class="tok num">${esc(x)}</span>`).join(" ") : `<span class="meta">none</span>`);
  const settings = [
    ["Product", esc(c.product)],
    ["Budget per run", `<span class="num">${usd(budget)}</span>`],
    ["Minimum score", `<span class="num">${c.minScore}</span>, Slack and webhook from <span class="num">${c.notify.minScore}</span>`],
    ["Intent queries", list(c.intent.enabled ? c.intent.queries : [])],
    ["Hiring titles", list(c.hiring.enabled ? c.hiring.titles : [])],
    ["Watched accounts", list(c.accounts.list.map((a) => a.domain ?? a.name))],
    ["Competitor tech", list(c.accounts.competitorTech)],
  ]
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join("");

  const dialog = q
    ? `<dialog id="quote"><form method="dialog"><div class="dh"><div class="h2">Run the listener</div><button class="x" aria-label="Close">×</button></div>
<p class="meta">Nothing runs until you start it. Prices: ${esc(i.pricesSource ?? "public catalog")}.</p>
<table class="tbl"><thead><tr><th>Source</th><th class="r">Calls</th><th class="r">At most</th></tr></thead><tbody>${Object.entries(q.bySource)
        .map(([src, row]) => `<tr><td class="num">${esc(src)}</td><td class="r num">${row.calls}</td><td class="r num">${row.maxMicros ? usd(row.maxMicros) : "free"}</td></tr>`)
        .join("")}</tbody><tfoot><tr><td>Total, ${q.paidCalls} paid</td><td class="r num">${q.calls}</td><td class="r num">${usd(q.maxMicros)}</td></tr></tfoot></table>
<div class="cap"><span>Cap for this run</span><b class="num">${usd(budget)}</b></div>
<p class="meta">A call that would pass the cap is skipped before it is made. A rerun on the same UTC day replays instead of charging again.</p>
<div class="cmd num"><span>$</span> node src/cli.ts run --html out/report.html</div>
<div class="df"><button class="btn ghost">Close</button></div></form></dialog>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signals, ${esc(when)}</title>
<style>${CSS}</style></head>
<body>
<nav class="rail"><div class="logo">${ICON}<span>signal-listener</span></div>
${NAV.map(([id, label], n) => `<a href="#${id}"${n === 0 ? ' class="on"' : ""}>${label}</a>`).join("")}
<div class="spend"><div class="label">Spend this run</div><div class="num big">${usd(r.costMicros)}</div><div class="sbar"><span style="width:${spentPct}%"></span></div><div class="cap2">of the ${usd(budget)} budget</div></div>
<div class="powered">Powered by looot</div></nav>
<main>
<header class="top"><div class="crumb">Runs <span>/</span> <b>${esc(when)}</b></div><div class="acts">${i.label ? `<span class="pill">${esc(i.label)}</span>` : ""}${runBtn}</div></header>
<section class="head"><h1>${esc(c.product || "Signals")}</h1><div class="meta"><span class="num">${r.calls}</span> calls · <span class="num">${usd(r.costMicros)}</span> spent · minimum score <span class="num">${c.minScore}</span></div></section>
<section class="stats">
<div><div class="label">Leads found</div><div class="stat">${r.signals.length}</div><div class="meta"><b class="up">${fresh.length} new</b> since the last run</div></div>
<div><div class="label">Accounts</div><div class="stat">${r.accounts.length}</div><div class="meta">${top ? `top: ${esc(top.company)}, score ${top.score}` : "no company signals"}</div></div>
<div><div class="label">Changes</div><div class="stat">${changes.length}</div><div class="meta">tech stacks and watched pages</div></div>
<div><div class="label">Spend vs budget</div><div class="stat">${usd(r.costMicros)}</div><div class="sbar light"><span style="width:${spentPct}%"></span></div><div class="meta">${spentPct}% of ${usd(budget)}</div></div>
</section>
<section class="grid" id="leads"><div class="panel"><div class="ph"><div class="h2">Leads <span class="meta">best first, with the reason for every point</span></div></div>
<table class="tbl leads"><colgroup><col style="width:64px"><col style="width:116px"><col></colgroup><thead><tr><th>Score</th><th>Kind</th><th>Signal</th></tr></thead><tbody>${leadRows || `<tr><td colspan="3" class="empty">Nothing at or above the minimum score this run.</td></tr>`}</tbody></table></div>
${detail}</section>
<section class="panel" id="accounts"><div class="ph"><div class="h2">Accounts <span class="meta">company signals grouped, two kinds score higher than one</span></div></div>
<table class="tbl"><colgroup><col style="width:64px"><col style="width:240px"><col style="width:80px"><col></colgroup><thead><tr><th>Score</th><th>Company</th><th class="r">Signals</th><th>Kinds</th></tr></thead><tbody>${accountRows || `<tr><td colspan="4" class="empty">No company signals this run.</td></tr>`}</tbody></table></section>
<section class="panel" id="changes"><div class="ph"><div class="h2">Changes <span class="meta">compared with the last snapshot</span></div></div><div class="changes">${changeCards}</div></section>
<section class="two">
<div class="panel" id="sources"><div class="ph"><div class="h2">Sources <span class="meta">next run, worst case</span></div></div>
<table class="tbl"><thead><tr><th>Source</th><th class="r">Calls</th><th class="r">At most</th><th class="r">Found</th></tr></thead><tbody>${sourceRows || `<tr><td colspan="4" class="empty">No quote in this report.</td></tr>`}</tbody></table></div>
<div class="panel" id="costs"><div class="ph"><div class="h2">Costs <span class="meta">last ${Math.min(14, runs.length)} runs</span></div></div>
<table class="tbl"><colgroup><col style="width:160px"><col style="width:60px"><col style="width:90px"><col><col style="width:60px"><col style="width:50px"></colgroup><thead><tr><th>Run</th><th class="r">Calls</th><th class="r">Spent</th><th></th><th class="r">Found</th><th class="r">New</th></tr></thead><tbody>${runRows || `<tr><td colspan="6" class="empty">No earlier runs in the state file.</td></tr>`}</tbody></table></div>
</section>
<section class="panel" id="settings"><div class="ph"><div class="h2">Settings <span class="meta">from icp.json, edit the file to change them</span></div></div><table class="kv">${settings}</table></section>
<footer class="meta">Generated by looot-signal-listener on ${esc(r.at)}. Static file, no tracking, no network requests.</footer>
</main>
${dialog}
<script>if(location.hash==="#quote"){var d=document.getElementById("quote");if(d)d.showModal()}</script>
</body></html>
`;
}

const CSS = `
:root{--bg:#f7f8f5;--surface:#fff;--rule:#e3e7e0;--rule-strong:#cfd6cc;--text:#0b2e22;--muted:#56695f;--brand:#0b4a35;--brand-fg:#f7f8f5;--accent:#12a06a;--accent-text:#0a7a50;--neg:#b4472f;--warn:#8a5f00;--hover:#f1f4ee;--selected:#e7f3ec;--sidebar:#0b2e22;--sidebar-fg:#e6ede8;--sidebar-muted:#9db3a8;--sidebar-active:#174636;
--sans:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html{background:var(--bg);color:var(--text)}
body{margin:0;font-family:var(--sans);font-size:13px;line-height:20px;-webkit-font-smoothing:antialiased;padding-left:232px}
a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.label{font-size:12px;line-height:16px;font-weight:500;color:var(--muted)}
.meta{color:var(--muted);font-size:12px;font-weight:400}
.h2{font-size:14px;font-weight:600}.h2 .meta{margin-left:8px}
.rail{position:fixed;left:0;top:0;bottom:0;width:232px;background:var(--sidebar);color:var(--sidebar-fg);padding:14px 10px;display:flex;flex-direction:column;gap:2px}
.logo{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px;padding:4px 8px 16px}
.rail a{padding:7px 10px;border-radius:6px;color:var(--sidebar-fg);font-size:13.5px}
.rail a.on{background:var(--sidebar-active);box-shadow:inset 2px 0 0 #2fc48a}
.rail a:hover{background:var(--sidebar-active);text-decoration:none}
.spend{margin-top:auto;background:rgba(255,255,255,.05);border-radius:8px;padding:12px}
.spend .label{color:var(--sidebar-muted)}.spend .big{font-size:15px;margin:4px 0 8px}
.cap2{font-size:11.5px;color:var(--sidebar-muted);margin-top:6px}
.sbar{height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}.sbar span{display:block;height:100%;background:#2fc48a}
.sbar.light{background:var(--rule);margin:6px 0 4px}.sbar.light span{background:var(--accent)}
.powered{font-size:11px;color:var(--sidebar-muted);padding:10px 8px 0}
main{min-width:0}section{scroll-margin-top:48px}
.top{position:sticky;top:0;z-index:5;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--rule);background:var(--bg)}
.crumb{color:var(--muted)}.crumb b{color:var(--text);font-weight:500}.crumb span{margin:0 6px}
.acts{display:flex;align-items:center;gap:10px}
.pill{font-size:11.5px;font-weight:500;color:var(--warn);background:#fbf3df;border:1px solid #ecd9a6;border-radius:999px;padding:1px 9px}
.btn{font:500 13px var(--sans);background:var(--brand);color:var(--brand-fg);border:0;border-radius:6px;padding:7px 12px;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.btn i{width:3px;height:3px;border-radius:50%;background:#8fc7ae}.btn b{font-weight:500}
.btn.ghost{background:var(--surface);color:var(--text);border:1px solid var(--rule-strong)}
.head{padding:20px 24px 16px}.head h1{font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em;margin:0 0 2px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);background:var(--surface)}
.stats>div{padding:14px 24px}.stats>div+div{border-left:1px solid var(--rule)}
.stat{font-family:var(--mono);font-size:28px;line-height:34px;font-weight:500;letter-spacing:-.02em;margin:4px 0 2px}
.up{color:var(--accent-text);font-weight:500}
.panel{background:var(--surface);border-bottom:1px solid var(--rule)}
section.panel,.two{border-top:1px solid var(--rule)}
.ph{display:flex;align-items:flex-start;justify-content:space-between;padding:16px 24px 10px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;border-bottom:1px solid var(--rule);background:var(--surface)}
.grid>.panel{border-bottom:0}.detail{border-left:1px solid var(--rule)}
.two{display:grid;grid-template-columns:1fr 1fr}.two>.panel+.panel{border-left:1px solid var(--rule)}
.tbl{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
.tbl th{height:32px;padding:0 12px;text-align:left;font-size:12px;font-weight:500;color:var(--muted);border-bottom:1px solid var(--rule);white-space:nowrap}
.tbl td{padding:8px 12px;border-bottom:1px solid var(--rule);vertical-align:top}
.tbl th:first-child,.tbl td:first-child{padding-left:24px}.tbl th:last-child,.tbl td:last-child{padding-right:24px}
.tbl td.nw{white-space:nowrap}.tbl tbody tr:hover td{background:var(--hover)}.tbl .r{text-align:right}
.tbl tfoot td{font-weight:600;border-bottom:0}
.leads td{padding-top:12px;padding-bottom:12px}
.t{font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10.5px;font-weight:600;color:var(--accent-text);background:var(--selected);border-radius:4px;padding:0 5px;margin-left:4px;vertical-align:1px}
.score{display:inline-grid;place-items:center;min-width:34px;height:24px;padding:0 6px;border-radius:6px;font:600 13px var(--mono);color:var(--accent-text);background:var(--selected);border:1px solid #cfe8da}
.score.hot{color:#fff;background:var(--brand);border-color:var(--brand)}
.kind{display:inline-block;font-size:11.5px;font-weight:500;color:var(--k);background:color-mix(in srgb,var(--k) 10%,white);border:1px solid color-mix(in srgb,var(--k) 24%,white);border-radius:5px;padding:0 6px;white-space:nowrap}
.reasons{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.reason{font-size:11.5px;line-height:18px;color:var(--text);background:var(--bg);border:1px solid var(--rule);border-radius:5px;padding:0 6px}
.reason b{font-family:var(--mono);color:var(--accent-text);font-weight:600}.reason b.neg{color:var(--neg)}
.detail .ph{border-bottom:1px solid var(--rule);padding-bottom:14px}.detail .h2{font-size:16px;margin-top:2px}
.pad{padding:14px 20px 4px}
.item{padding:10px 20px 12px;border-bottom:1px solid var(--rule)}.item .t{margin-top:6px;white-space:normal}
.diff{margin-top:6px;border:1px solid var(--rule);border-radius:6px;background:var(--bg);padding:6px 10px;font-size:12px;line-height:19px}
.add{color:var(--accent-text)}.del{color:var(--neg)}
.changes{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 24px 20px}
.change{display:flex;gap:12px;border:1px solid var(--rule);border-radius:8px;padding:12px 14px}.change>div{min-width:0}.change .t{margin-top:6px;white-space:normal}
.bar{display:block;height:6px;border-radius:3px;background:var(--bg);margin-top:7px}.bar span{display:block;height:100%;border-radius:3px;background:var(--accent)}
.kv{width:100%;border-collapse:collapse}.kv th{width:200px;text-align:left;font-weight:500;color:var(--muted);padding:9px 24px;border-top:1px solid var(--rule);vertical-align:top}
.kv td{padding:9px 24px 9px 0;border-top:1px solid var(--rule)}
.tok{display:inline-block;font-size:12px;background:var(--bg);border:1px solid var(--rule);border-radius:5px;padding:0 6px;margin:0 2px 4px 0}
.empty{color:var(--muted);padding:16px 24px}
footer{padding:16px 24px 40px}
dialog:focus{outline:none}dialog{border:1px solid var(--rule-strong);border-radius:8px;padding:0;width:440px;color:var(--text);box-shadow:0 12px 32px -12px rgb(11 46 34/.22),0 2px 6px -2px rgb(11 46 34/.08)}
dialog::backdrop{background:rgb(11 46 34/.18)}
dialog form{padding:18px 20px}dialog .tbl th:first-child,dialog .tbl td:first-child{padding-left:0}dialog .tbl th:last-child,dialog .tbl td:last-child{padding-right:0}
dialog .tbl td{padding:5px 12px}
.dh{display:flex;justify-content:space-between;align-items:center}.x{border:0;background:none;font-size:18px;color:var(--muted);cursor:pointer}
.cap{display:flex;justify-content:space-between;margin:14px 0 4px;padding:9px 12px;border:1px solid var(--rule);border-radius:6px;background:var(--bg)}
.cmd{margin:12px 0;background:var(--sidebar);color:var(--sidebar-fg);border-radius:6px;padding:9px 12px;font-size:12px}.cmd span{color:#8fc7ae;margin-right:6px}
.df{display:flex;justify-content:flex-end}
@media (max-width:900px){body{padding-left:0}.rail{position:static;width:auto;flex-direction:row;flex-wrap:wrap}.spend,.powered{display:none}.grid,.two,.changes,.stats{grid-template-columns:1fr}.detail{border-left:0}}
`;
