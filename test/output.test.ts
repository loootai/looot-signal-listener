import assert from "node:assert/strict";
import { test } from "node:test";
import { validate } from "../src/config.ts";
import type { RunResult } from "../src/engine.ts";
import { csv, emailDrafts, notify, slackPayload, table, webhookPayload } from "../src/output.ts";
import { prune, emptyState } from "../src/state.ts";
import { parseArgs } from "../src/cli.ts";
import { cfg, fakeFetch, NOW } from "./helpers.ts";

const c = cfg({ product: "Deliverability audits", notify: { minScore: 40, slackWebhookEnv: "SLACK_WEBHOOK_URL", webhookEnv: "SIGNAL_WEBHOOK_URL" } });

const result: RunResult = {
  at: NOW.toISOString(),
  calls: 3,
  costMicros: 3640,
  log: [],
  signals: [
    { id: "a", kind: "funding", source: "funding", title: "Rocketlane raises $24M, Series A", text: "", url: "https://t.co/a", author: null, company: "Rocketlane", domain: "rocketlane.com", publishedAt: null, engagement: 0, query: "", score: 55, reasons: [{ points: 30, why: "funding signal" }, { points: 25, why: 'pain: "x"' }], isNew: true },
    { id: "b", kind: "intent", source: "reddit", title: 'Spam, "help"', text: "", url: "https://reddit.com/b", author: "u/b", company: "r/sales", domain: null, publishedAt: null, engagement: 0, query: "", score: 45, reasons: [{ points: 45, why: "pain" }], isNew: false },
    { id: "c", kind: "hiring", source: "linkedin_jobs", title: "Acme is hiring: SDR Manager", text: "", url: null, author: null, company: "Acme", domain: null, publishedAt: null, engagement: 0, query: "", score: 20, reasons: [{ points: 20, why: "hiring signal" }], isNew: true },
  ],
  accounts: [],
};

test("table shows score, reasons and the run total", () => {
  const t = table(result);
  assert.match(t, /^SCORE/);
  assert.match(t, /why: \+30 funding signal; \+25 pain: "x"/);
  assert.match(t, /3 calls, \$0.00364 spent, 3 signals, 2 new/);
  assert.ok(!table(result, 25, true).includes("Spam"), "--new-only hides seen signals");
});

test("csv quotes commas and quotes", () => {
  const lines = csv(result).trim().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[2], /"Spam, ""help"""/);
});

test("only new signals at notify.minScore reach Slack, the webhook and the drafts", () => {
  assert.match(slackPayload(result, c).text, /^\*1 new signal\* at score 40\+ for Deliverability audits/);
  assert.equal(webhookPayload(result, c).signals.length, 1);
  const drafts = emailDrafts(result, c);
  assert.match(drafts, /## Rocketlane \(score 55\)/);
  assert.match(drafts, /Congrats on the round/);
  assert.ok(!drafts.includes("Acme"));
});

test("notify posts to each webhook named in env, and skips when none is set", async () => {
  const { fetch, calls } = fakeFetch({ "https://hooks.example/slack": {}, "https://hooks.example/any": {} });
  const done = await notify(result, c, { SLACK_WEBHOOK_URL: "https://hooks.example/slack", SIGNAL_WEBHOOK_URL: "https://hooks.example/any" }, fetch);
  assert.deepEqual(done, ["notify: slack sent", "notify: webhook sent"]);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(JSON.stringify(calls[1].body)).signals[0].id, "a");
  assert.match((await notify(result, c, {}, fetch))[0], /no SLACK_WEBHOOK_URL or SIGNAL_WEBHOOK_URL set/);
});

test("config validation catches empty queries and pasted secrets", () => {
  assert.deepEqual(validate(cfg({ intent: { enabled: false } })), []);
  assert.match(validate(cfg({ intent: { enabled: true, queries: [] } }))[0], /intent.queries is empty/);
  assert.ok(validate(cfg({ product: "https://hooks.slack.com/services/T/B/x", intent: { enabled: false } })).some((e) => /secret or webhook/.test(e)));
});

test("state prune drops old fingerprints and keeps recent ones", () => {
  const s = emptyState();
  s.seen = { old: "2026-01-01T00:00:00Z", recent: "2026-10-01T00:00:00Z" };
  assert.deepEqual(Object.keys(prune(s, NOW).seen), ["recent"]);
});

test("cli args: command, flags with values and switches", () => {
  assert.deepEqual(parseArgs(["run", "--config", "a.json", "--json", "--limit=5"]), { cmd: "run", opts: { config: "a.json", json: true, limit: "5" } });
  assert.equal(parseArgs([]).cmd, "help");
});
