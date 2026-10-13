import assert from "node:assert/strict";
import { test } from "node:test";
import { companyFromHeadline, pageLines, parseCustom, parseFunding, parseHn, parseJobs, parseNews, parseReddit, parseX, planCalls, techNames } from "../src/sources.ts";
import * as fx from "./fixtures.ts";
import { cfg, NOW } from "./helpers.ts";

test("reddit rows become intent signals with permalink, subreddit and engagement", () => {
  const rows = parseReddit(fx.reddit, NOW, "cold email spam");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://www.reddit.com/r/sales/comments/r1/x/");
  assert.equal(rows[0].company, "r/sales");
  assert.equal(rows[0].author, "u/growthpm");
  assert.equal(rows[0].engagement, 62);
  assert.equal(rows[0].publishedAt, "2026-10-12T12:00:00.000Z");
});

test("reddit rows wrapped in a looot output envelope still parse", () => {
  assert.equal(parseReddit({ output: { data: fx.reddit } }, NOW).length, 2);
});

test("x rows build a status URL from handle and id when the provider gives none", () => {
  const rows = parseX(fx.x, NOW);
  assert.equal(rows[0].url, "https://x.com/revops_jane/status/x1");
  assert.equal(rows[0].author, "@revops_jane");
  assert.equal(rows[0].engagement, 21);
});

test("hn stories and comments both parse; comments keep the thread title", () => {
  const rows = parseHn(fx.hn, NOW);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].title, "Comment on: Cold email in 2026");
  assert.equal(rows[1].url, "https://news.ycombinator.com/item?id=h2");
});

test("jobs read company from a string or an object, and relative dates", () => {
  const rows = parseJobs(fx.jobs, NOW);
  assert.equal(rows[0].company, "Acme Analytics");
  assert.equal(rows[1].company, "Attio");
  assert.equal(rows[1].domain, "attio.com");
  assert.equal(rows[1].publishedAt, "2026-10-10T12:00:00.000Z");
  assert.match(rows[0].title, /Acme Analytics is hiring: SDR Manager/);
});

test("predictleads funding joins the company from the included list", () => {
  const [row] = parseFunding(fx.predictleads, NOW);
  assert.equal(row.company, "Acme Analytics");
  assert.equal(row.domain, "acme.io");
  assert.match(row.title, /raised \$12,000,000 \(series a\)/);
});

test("news guesses the company from the headline", () => {
  assert.equal(companyFromHeadline("Northwind appoints Maria Lopez as VP of Sales"), "Northwind");
  assert.equal(companyFromHeadline("Why outbound is hard"), null);
  const [row] = parseNews("leadership", "leadership")(fx.leadershipNews, NOW);
  assert.equal(row.company, "Northwind");
  assert.equal(row.kind, "leadership");
});

test("tech names are lower case, unique and sorted", () => {
  assert.deepEqual(techNames(fx.techBefore), ["cloudflare", "hubspot", "lemlist"]);
  assert.deepEqual(techNames({ technologies: ["x"] }), []);
});

test("page lines drop images and blank lines", () => {
  assert.deepEqual(pageLines({ data: { content: "# Hi\n\n![logo](a.png)\nPlan A" } }), ["# Hi", "Plan A"]);
  assert.deepEqual(pageLines("plain text page"), ["plain text page"]);
});

test("custom source maps fields with alternatives", () => {
  const parse = parseCustom({ name: "yt", enabled: true, kind: "intent", endpointId: "e", input: {}, queries: [], itemsPath: "data.videos", fields: { title: "title", url: "link|url", author: "channel" } });
  const [row] = parse({ data: { videos: [{ title: "Fix spam", url: "https://y.t/1", channel: "c" }] } }, NOW, "q");
  assert.equal(row.url, "https://y.t/1");
  assert.equal(row.author, "c");
  assert.equal(row.source, "yt");
});

test("plan: HN is free and goes to Algolia, paid calls name a pinned endpoint", () => {
  const calls = planCalls(cfg({ intent: { enabled: true, sources: ["reddit", "hn"], queries: ["a"] } }), NOW);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endpointId, "scrapecreators-reddit-search");
  assert.equal(calls[1].endpointId, null);
  assert.match(calls[1].freeUrl!, /^https:\/\/hn\.algolia\.com\/api\/v1\/search_by_date\?/);
});

test("plan: predictleads funding is billed per result, so maxUnits is the limit", () => {
  const [call] = planCalls(cfg({ intent: { enabled: false }, funding: { enabled: true, source: "predictleads", stages: ["series_a"], limit: 30 } }), NOW);
  assert.equal(call.maxUnits, 30);
  assert.equal(call.input.financing_types_normalized, "series_a");
});

test("plan: custom source fills {q} and {days}", () => {
  const [call] = planCalls(cfg({ intent: { enabled: false }, lookbackDays: 3, custom: [{ name: "c", enabled: true, kind: "news", endpointId: "e1", input: { q: "{q} last {days} days", n: 5 }, queries: ["spam"] }] }), NOW);
  assert.deepEqual(call.input, { q: "spam last 3 days", n: 5 });
});
