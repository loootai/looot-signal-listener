import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quote, RunResult } from "../src/engine.ts";
import { parseArgs } from "../src/cli.ts";
import { esc, renderReport } from "../src/report.ts";
import { cfg, NOW } from "./helpers.ts";

const c = cfg({ product: "Deliverability audits", budgetUsd: 0.25, minScore: 15 });

const base = { text: "", author: null, publishedAt: null, engagement: 0, query: "" };
const result: RunResult = {
  at: NOW.toISOString(),
  calls: 24,
  costMicros: 20000,
  log: [],
  signals: [
    { ...base, id: "t", kind: "tech_change", source: "techstack", title: "linear.app added salesforce; removed lemlist", url: "https://linear.app", company: "Linear", domain: "linear.app", query: "linear.app", facts: { added: ["salesforce"], removed: ["lemlist"] }, score: 75, reasons: [{ points: 25, why: "dropped competitor tech: lemlist" }, { points: 20, why: "tech change signal" }], isNew: true },
    { ...base, id: "p", kind: "website_change", source: "website", title: "https://linear.app/pricing changed: 1 new line", url: "https://linear.app/pricing", company: "Linear", domain: "linear.app", facts: { addedLines: ["Enterprise: SSO, SOC 2 and audit logs"] }, score: 51, reasons: [{ points: 16, why: "new text on the page mentions: enterprise" }], isNew: true },
    { ...base, id: "x", kind: "intent", source: "reddit", title: '<img src=x onerror=alert(1)> "spam"', url: "javascript:alert(1)", author: "u/growthpm", company: null, domain: null, score: 40, reasons: [{ points: 27, why: 'pain: "landing in spam"' }, { points: -8, why: 'self-promo: "i built"' }], isNew: false },
  ],
  accounts: [],
};
result.accounts = [{ key: "linear.app", company: "Linear", domain: "linear.app", score: 95, kinds: ["tech_change", "website_change"], signals: 2, top: result.signals[0] }];

const q: Quote = { calls: 24, paidCalls: 20, maxMicros: 35200, bySource: { reddit: { calls: 4, maxMicros: 7520 }, hn: { calls: 4, maxMicros: 0 } }, unpriced: [] };
const runs = [
  { at: "2026-10-11T07:00:00.000Z", calls: 24, costMicros: 20000, found: 8, new: 8 },
  { at: "2026-10-12T07:00:00.000Z", calls: 24, costMicros: 20000, found: 12, new: 4 },
];

test("report shows the stats, the leads with reason chips and the spend against the budget", () => {
  const html = renderReport({ result, config: c, quote: q, runs });
  assert.match(html, /<h1>Deliverability audits<\/h1>/);
  assert.match(html, /Leads found<\/div><div class="stat">3</);
  assert.match(html, /2 new<\/b> since the last run/);
  assert.match(html, /<b class="">\+25<\/b> dropped competitor tech: lemlist/);
  assert.match(html, /<b class="neg">-8<\/b>/, "negative points get the negative colour");
  assert.match(html, /8% of \$0\.2500/, "$0.02 of $0.25 is 8%");
});

test("report escapes titles and links only http and https URLs", () => {
  const html = renderReport({ result, config: c });
  assert.ok(!html.includes("<img src=x"), "a title cannot inject markup");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; &quot;spam&quot;"));
  assert.ok(!html.includes('href="javascript:'), "a javascript: URL is not a link");
  assert.equal(esc(`a<b>"c"&'d'`), "a&lt;b&gt;&quot;c&quot;&amp;&#39;d&#39;");
});

test("the account panel shows what changed: removed tech in red, added tech and page lines in green", () => {
  const html = renderReport({ result, config: c });
  const panel = html.slice(html.indexOf('<aside class="panel detail">'), html.indexOf("</aside>"));
  assert.match(panel, /<div class="h2">Linear<\/div>/);
  assert.match(panel, /<div class="del">- lemlist<\/div>/);
  assert.match(panel, /<div class="add">\+ salesforce<\/div>/);
  assert.match(panel, /<div class="add">\+ Enterprise: SSO, SOC 2 and audit logs<\/div>/);
  assert.ok(!panel.includes("Seen in earlier runs"), "both Linear signals are new");
});

test("the run dialog shows the quote per source and the cap, and the costs table lists earlier runs newest first", () => {
  const html = renderReport({ result, config: c, quote: q, runs, pricesSource: "live public catalog", label: "Demo data" });
  assert.match(html, /Run now <i><\/i> <b class="num">\$0\.0352<\/b>/);
  assert.match(html, /<td class="num">hn<\/td><td class="r num">4<\/td><td class="r num">free<\/td><\/tr>/);
  assert.match(html, /Total, 20 paid/);
  assert.match(html, /Prices: live public catalog/);
  assert.match(html, /<span class="pill">Demo data<\/span>/);
  assert.ok(html.indexOf("2026-10-12 07:00") < html.indexOf("2026-10-11 07:00"));
});

test("an empty run renders empty states and no dialog without a quote", () => {
  const html = renderReport({ result: { ...result, signals: [], accounts: [] }, config: c });
  assert.match(html, /Nothing at or above the minimum score this run/);
  assert.match(html, /No tech stack or page changes this run/);
  assert.match(html, /No earlier runs in the state file/);
  assert.ok(!html.includes("<dialog"));
  assert.ok(!html.includes("Run now"));
  assert.ok(!/<(link|img)\b[^>]*(src|href)="https?:/.test(html), "the page loads nothing from the network");
});

test("cli: report takes --from and --html", () => {
  assert.deepEqual(parseArgs(["report", "--from", "out/run.json", "--html", "out/r.html"]), { cmd: "report", opts: { from: "out/run.json", html: "out/r.html" } });
});
