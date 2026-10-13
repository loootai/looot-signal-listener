import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { RunResult } from "../src/engine.ts";
import { isImage, loadLogos, LOGO_URL } from "../src/logos.ts";
import { redactText, renderReport } from "../src/report.ts";
import { planCalls } from "../src/sources.ts";
import { cfg, NOW } from "./helpers.ts";

// out/ is gitignored, so a failed test leaves nothing to commit.
const DIR = join(import.meta.dirname, "..", "out", `test-logos-${process.pid}`);
after(() => rmSync(DIR, { recursive: true, force: true }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("loadLogos reads a cached file, fetches and caches a missing one, and skips a non-image answer", async () => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, "clay.com.png"), PNG);
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(String(url));
    return String(url).includes("apify.com") ? new Response(PNG, { status: 200 }) : new Response("<html>not found</html>", { status: 200 });
  }) as unknown as typeof fetch;
  const logos = await loadLogos(["clay.com", "https://www.apify.com/pricing", "nologo.example", null], DIR, { online: true, fetch: f });
  assert.deepEqual(Object.keys(logos).sort(), ["apify.com", "clay.com"]);
  assert.match(logos["clay.com"], /^data:image\/png;base64,/);
  assert.deepEqual(asked, [LOGO_URL("apify.com"), LOGO_URL("nologo.example")], "a cached logo is not fetched again");
  assert.ok(existsSync(join(DIR, "apify.com.png")), "a fetched logo is cached");
  assert.ok(!existsSync(join(DIR, "nologo.example.png")), "an HTML answer is not cached as a logo");
  assert.deepEqual([...readFileSync(join(DIR, "apify.com.png"))], [...PNG]);
});

test("loadLogos offline makes no network call and returns only cached logos", async () => {
  const f = (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch;
  const logos = await loadLogos(["clay.com", "missing.example"], DIR, { fetch: f });
  assert.deepEqual(Object.keys(logos), ["clay.com"]);
  assert.equal(isImage(new TextEncoder().encode("<svg")), false);
});

const c = cfg({ product: "Data API", accounts: { list: [{ name: "Clay", domain: "clay.com" }, { name: "Apify", domain: "apify.com" }] } });
const base = { text: "", publishedAt: null, engagement: 0, query: "" };
const result: RunResult = {
  at: NOW.toISOString(),
  calls: 3,
  costMicros: 3000,
  log: [],
  signals: [
    { ...base, id: "n", kind: "news", source: "news", title: "Clay raises a round", url: "https://example.com/a", author: null, company: "Clay", domain: "clay.com", score: 40, reasons: [{ points: 15, why: "on your account list: Clay" }], isNew: true },
    { ...base, id: "x", kind: "intent", source: "x", title: "@jane_doe any clay alternative? mail me jane@example.com or +1 415 555 0100", url: "https://x.com/jane_doe/status/1", author: "@jane_doe", company: null, domain: null, score: 50, reasons: [], isNew: true },
  ],
  accounts: [],
};
result.accounts = [{ key: "clay.com", company: "Clay", domain: "clay.com", score: 40, kinds: ["news"], signals: 1, top: result.signals[0] }];

test("the report works without logos: names only, no <img>, no owners line", () => {
  const html = renderReport({ result, config: c });
  assert.ok(!html.includes("<img"), "no logo images without logos");
  assert.match(html, /<div class="t">Clay<\/div>/);
  assert.ok(!html.includes("Logos and names belong to their owners"));
});

test("with logos the report shows them inline as data URIs and adds the owners line; a remote URL is never used", () => {
  const logos = { "clay.com": "data:image/png;base64,iVBORw0KGgo=", "apify.com": "https://evil.example/logo.png" };
  const html = renderReport({ result, config: c, logos });
  assert.match(html, /<div class="t"><img class="lg" src="data:image\/png;base64,iVBORw0KGgo=" alt="" width="16" height="16">Clay<\/div>/);
  assert.ok(!html.includes("evil.example"), "only data: URIs render");
  assert.match(html, /Apify <span class="num meta">apify\.com<\/span>/, "an account without a usable logo still shows its name");
  assert.match(html, /Logos and names belong to their owners\. Public data from a live run on 2026-10-12\. No affiliation\./);
  assert.ok(!/<(link|img)\b[^>]*(src|href)="https?:/.test(html), "the page still loads nothing from the network");
});

test("redact hides post authors, handles, emails and phone numbers, and keeps company names", () => {
  const html = renderReport({ result, config: c, redact: true, label: "Live run · 2026-10-12" });
  assert.ok(!html.includes("jane"), "no handle or email of the author anywhere in the page text");
  assert.match(html, /@… any clay alternative\? mail me \[email\] or \[phone\]/);
  assert.match(html, /<span class="num">x<\/span><\/div>/, "an X post shows its source only");
  assert.match(html, /<span class="pill live">Live run · 2026-10-12<\/span>/);
  assert.match(html, /<div class="t">Clay<\/div>/);
  assert.equal(redactText("Q3 report 2026-10-13, see u/someone"), "Q3 report 2026-10-13, see u/…", "a date is not a phone number");
  assert.equal(redactText("x".repeat(200)).length, 140);
});

test("hiring calls send a postedLimit the jobs endpoint accepts, and newsQuery replaces the quoted name", () => {
  const calls = planCalls(cfg({ intent: { enabled: false }, hiring: { enabled: true, titles: ["GTM Engineer"] }, accounts: { list: [{ name: "Clay", domain: "clay.com", newsQuery: '"Clay" GTM' }, { name: "Apify", domain: "apify.com" }] } }), NOW);
  assert.equal(calls.find((x) => x.source === "linkedin_jobs")?.input.postedLimit, "week");
  assert.deepEqual(calls.filter((x) => x.source === "news").map((x) => x.input.q), ['"Clay" GTM', '"Apify"']);
});
