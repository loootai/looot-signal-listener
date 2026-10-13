import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPrices, quote, runOnce, type Prices } from "../src/engine.ts";
import { LoootClient } from "../src/looot.ts";
import { ENDPOINTS, planCalls } from "../src/sources.ts";
import { emptyState } from "../src/state.ts";
import * as fx from "./fixtures.ts";
import { cfg, fakeFetch, NOW } from "./helpers.ts";

const HN = "https://hn.algolia.com/";

const fullConfig = cfg({
  budgetUsd: 1,
  minScore: 10,
  rules: { pain: { "landing in spam": 15, "going to spam": 15, "domain reputation": 10 }, intent: { "any recommendations": 10, "alternative to": 12 }, negative: { "check out my": -10, giveaway: -15 } },
  intent: { enabled: true, sources: ["reddit", "x", "hn"], queries: ["cold email spam"] },
  hiring: { enabled: true, titles: ["SDR Manager"] },
  funding: { enabled: true, source: "news", stages: [], limit: 20 },
  leadership: { enabled: true, roles: ["VP of Sales"] },
  accounts: { list: [{ name: "Linear", domain: "linear.app", pages: ["https://linear.app/pricing"] }], news: true, techstack: true, website: true, competitorTech: ["lemlist"], watchTech: ["salesforce"], pageKeywords: ["enterprise"] },
});

function routes(tech: unknown, page: unknown) {
  return {
    [HN]: fx.hn,
    [ENDPOINTS.reddit.id]: fx.reddit,
    [ENDPOINTS.x.id]: fx.x,
    [ENDPOINTS.jobs.id]: fx.jobs,
    [ENDPOINTS.news.id]: (input: Record<string, unknown> | null) => (String(input?.q).includes("raises") ? fx.fundingNews : String(input?.q).includes("appoints") ? fx.leadershipNews : fx.accountNews),
    [ENDPOINTS.techstack.id]: tech,
    [ENDPOINTS.page.id]: page,
  };
}

const offline = (c = fullConfig): Promise<Prices> => loadPrices(planCalls(c, NOW), { offline: true });
const client = (f: typeof fetch) => new LoootClient({ token: "test-token", fetch: f, sleep: async () => {} });

test("a full run calls every source once, dedupes the shared article and scores everything", async () => {
  const { fetch, calls } = fakeFetch(routes(fx.techBefore, fx.pageBefore));
  const state = emptyState();
  const r = await runOnce({ config: fullConfig, state, client: client(fetch), prices: await offline(), fetch, now: NOW });

  const runCalls = calls.filter((c) => c.url.includes("/v1/runs"));
  assert.equal(runCalls.length, planCalls(fullConfig, NOW).filter((c) => c.endpointId).length);
  assert.equal(calls.filter((c) => c.url.startsWith(HN)).length, 1);
  assert.ok(runCalls.every((c) => c.headers.Authorization === "Bearer test-token"));
  assert.ok(runCalls.every((c) => /^lsl-[0-9a-f]{24}$/.test(String(c.body?.idempotencyKey))));

  const rocketlane = r.signals.filter((s) => s.title.startsWith("Rocketlane raises"));
  assert.equal(rocketlane.length, 1, "same article from the funding query and the account news query is one signal");
  assert.equal(rocketlane[0].kind, "funding", "the first source that found it keeps it");

  assert.ok(r.signals.every((s) => s.isNew));
  assert.ok(r.signals.every((s) => (s.score ?? 0) >= 10));
  assert.ok(r.signals.every((s) => (s.reasons ?? []).length > 0));
  assert.ok(!r.signals.some((s) => s.title.includes("I built a free email warmup")), "self-promo is below minScore");
  assert.ok(r.log.some((l) => l.includes("techstack linear.app: first look, 3 technologies")));
  assert.ok(r.log.some((l) => l.includes("website https://linear.app/pricing: first look")));
  assert.equal(r.costMicros, runCalls.length * 1000, "spend is the sum of actualCost");
  assert.equal(state.runs.length, 1);
});

test("the second run marks old signals not new and emits tech and page changes", async () => {
  const state = emptyState();
  const first = fakeFetch(routes(fx.techBefore, fx.pageBefore));
  await runOnce({ config: fullConfig, state, client: client(first.fetch), prices: await offline(), fetch: first.fetch, now: NOW });

  const second = fakeFetch(routes(fx.techAfter, fx.pageAfter));
  const later = new Date(NOW.getTime() + 86_400_000);
  const r = await runOnce({ config: fullConfig, state, client: client(second.fetch), prices: await offline(), fetch: second.fetch, now: later });

  const fresh = r.signals.filter((s) => s.isNew);
  assert.deepEqual(fresh.map((s) => s.kind).sort(), ["tech_change", "website_change"]);
  const tech = fresh.find((s) => s.kind === "tech_change")!;
  assert.deepEqual(tech.facts, { added: ["salesforce"], removed: ["lemlist"] });
  assert.ok(tech.reasons!.some((x) => /dropped competitor tech: lemlist/.test(x.why)));
  const page = fresh.find((s) => s.kind === "website_change")!;
  assert.deepEqual(page.facts?.addedLines, ["Enterprise: SSO, SOC 2 and audit logs"]);
  assert.ok(r.accounts.some((a) => a.domain === "linear.app" && a.kinds.includes("tech_change")));
});

test("the budget skips calls that would pass it, before they are made", async () => {
  const c = cfg({ budgetUsd: 0.004, intent: { enabled: true, sources: ["reddit"], queries: ["a", "b", "c"] } });
  const { fetch, calls } = fakeFetch({ [ENDPOINTS.reddit.id]: fx.reddit }, { costUsd: 0.00188 });
  const r = await runOnce({ config: c, state: emptyState(), client: client(fetch), prices: await offline(c), fetch, now: NOW });
  assert.equal(calls.length, 2, "two calls at $0.00188 fit in $0.004, the third does not");
  assert.ok(r.log.some((l) => /"c": skipped, would pass the \$0.00400 budget/.test(l)));
});

test("a 402 stops every later paid call but free HN still runs", async () => {
  const c = cfg({ intent: { enabled: true, sources: ["reddit", "x", "hn"], queries: ["a", "b"] } });
  const { fetch, calls } = fakeFetch({ [HN]: fx.hn, [ENDPOINTS.x.id]: fx.x }, { status: { [ENDPOINTS.reddit.id]: 402 } });
  const r = await runOnce({ config: c, state: emptyState(), client: client(fetch), prices: await offline(c), fetch, now: NOW });
  assert.equal(calls.filter((x) => x.url.includes("/v1/runs")).length, 1, "only the first reddit call was made");
  assert.equal(calls.filter((x) => x.url.startsWith(HN)).length, 2);
  assert.ok(r.log.some((l) => l.includes("balance is empty (402)")));
});

test("without a token only free sources run and nothing is charged", async () => {
  const { fetch, calls } = fakeFetch({ [HN]: fx.hn });
  const r = await runOnce({ config: fullConfig, state: emptyState(), client: null, prices: await offline(), fetch, now: NOW });
  assert.equal(calls.length, 1);
  assert.equal(r.costMicros, 0);
  assert.ok(r.signals.length >= 1);
  assert.ok(r.log[0].includes("no LOOOT_TOKEN"));
});

test("a failed run is logged and does not stop the next call", async () => {
  const c = cfg({ intent: { enabled: true, sources: ["reddit", "x"], queries: ["a"] } });
  const { fetch } = fakeFetch({ [ENDPOINTS.x.id]: fx.x });
  const r = await runOnce({ config: c, state: emptyState(), client: client(fetch), prices: await offline(c), fetch, now: NOW });
  assert.ok(r.log.some((l) => l.startsWith('reddit "a": failed')));
  assert.ok(r.signals.some((s) => s.source === "x"));
});

test("a queued run is polled until it completes", async () => {
  let polls = 0;
  const f = (async (url: string) => {
    const u = String(url);
    if (u.includes("/v1/runs?wait")) return new Response(JSON.stringify({ runId: "r1", status: "running" }));
    polls += 1;
    return new Response(JSON.stringify(polls < 2 ? { runId: "r1", status: "running" } : { runId: "r1", status: "completed", result: fx.reddit, actualCost: 0.00188 }));
  }) as typeof fetch;
  const run = await new LoootClient({ token: "t", fetch: f, sleep: async () => {} }).runAndWait("e", {}, "k");
  assert.equal(run.status, "completed");
  assert.equal(polls, 2);
});

test("quote adds up worst-case cost per source and reads live prices from the public catalog", async () => {
  const c = cfg({ intent: { enabled: true, sources: ["reddit", "hn"], queries: ["a", "b"] }, funding: { enabled: true, source: "predictleads", stages: [], limit: 10 } });
  const calls = planCalls(c, NOW);
  const { fetch } = fakeFetch({
    "https://api.looot.ai/v1/public-catalog/scrapecreators-reddit-search": { price: { state: "known", amountMicros: 2000, unit: "call" } },
    "https://api.looot.ai/v1/public-catalog/predictleads-discover-financing-events": { price: { state: "known", amountMicros: 10000, unit: "result" } },
  });
  const p = await loadPrices(calls, { fetch });
  assert.equal(p.source, "catalog");
  const q = quote(calls, p);
  assert.equal(q.bySource.reddit.maxMicros, 4000);
  assert.equal(q.bySource.hn.maxMicros, 0);
  assert.equal(q.bySource.funding.maxMicros, 100_000);
  assert.equal(q.maxMicros, 104_000);
});

test("when the catalog cannot be read, the dated price is used and marked", async () => {
  const calls = planCalls(cfg({ intent: { enabled: true, sources: ["reddit"], queries: ["a"] } }), NOW);
  const f = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  const p = await loadPrices(calls, { fetch: f });
  assert.equal(p.source, "fallback");
  assert.equal(p.micros[ENDPOINTS.reddit.id], ENDPOINTS.reddit.micros);
});
