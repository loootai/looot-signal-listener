import assert from "node:assert/strict";
import { test } from "node:test";
import { rollupAccounts, scoreSignal } from "../src/score.ts";
import type { Signal } from "../src/types.ts";
import { cfg, NOW } from "./helpers.ts";

const sig = (p: Partial<Signal>): Signal => ({ id: "s", kind: "intent", source: "reddit", title: "", text: "", url: null, author: null, company: null, domain: null, publishedAt: null, engagement: 0, query: "", ...p });

const c = cfg({
  rules: { pain: { "landing in spam": 15, "open rates dropped": 12 }, intent: { "any recommendations": 10 }, negative: { "check out my": -10, giveaway: -15 } },
  icp: { personaWords: ["saas", "b2b"], countries: [] },
  accounts: { list: [{ name: "Attio", domain: "attio.com" }], competitorTech: ["lemlist"], watchTech: ["salesforce"], pageKeywords: ["enterprise", "soc 2"] },
});

test("every point has a reason, and the score is their sum", () => {
  const s = sig({ title: "Emails landing in spam, any recommendations?", text: "b2b saas, open rates dropped", engagement: 62, publishedAt: NOW.toISOString() });
  const { score, reasons } = scoreSignal(s, c, NOW);
  assert.equal(score, reasons.reduce((t, r) => t + r.points, 0));
  const whys = reasons.map((r) => r.why).join(" | ");
  assert.match(whys, /pain: "landing in spam", "open rates dropped"/);
  assert.match(whys, /intent: "any recommendations"/);
  assert.match(whys, /fits your buyer: saas, b2b/);
  assert.match(whys, /asks a question/);
  assert.match(whys, /posted in the last 2 days/);
});

test("self-promotion scores low", () => {
  const { score } = scoreSignal(sig({ title: "check out my tool", text: "giveaway" }), c, NOW);
  assert.equal(score, 0);
});

test("phrases match whole words only", () => {
  const { reasons } = scoreSignal(sig({ title: "saasy branding" }), c, NOW);
  assert.equal(reasons.length, 0);
});

test("a signal at a listed account gets the account bonus", () => {
  const { reasons } = scoreSignal(sig({ kind: "hiring", company: "Attio", domain: "attio.com", title: "Attio is hiring" }), c, NOW);
  assert.ok(reasons.some((r) => r.why === "on your account list: Attio" && r.points === 15));
});

test("dropping competitor tech beats adding it", () => {
  const dropped = scoreSignal(sig({ kind: "tech_change", domain: "x.io", facts: { added: ["salesforce"], removed: ["lemlist"] } }), c, NOW);
  const added = scoreSignal(sig({ kind: "tech_change", domain: "x.io", facts: { added: ["lemlist"], removed: [] } }), c, NOW);
  assert.ok(dropped.score > added.score);
  assert.ok(dropped.reasons.some((r) => /dropped competitor tech: lemlist/.test(r.why)));
  assert.ok(dropped.reasons.some((r) => /added tech you work with: salesforce/.test(r.why)));
});

test("website change scores the new keywords only", () => {
  const { reasons } = scoreSignal(sig({ kind: "website_change", facts: { addedLines: ["Enterprise: SSO, SOC 2"] } }), c, NOW);
  assert.ok(reasons.some((r) => r.why === "new text on the page mentions: enterprise, soc 2" && r.points === 16));
});

test("old posts lose points", () => {
  const { reasons } = scoreSignal(sig({ publishedAt: "2026-08-01T00:00:00Z" }), c, NOW);
  assert.ok(reasons.some((r) => r.points === -10));
});

test("score stays between 0 and 100", () => {
  const big = cfg({ rules: { pain: { a: 90 }, intent: { a: 90 }, negative: {} } });
  assert.equal(scoreSignal(sig({ kind: "funding", title: "a" }), big, NOW).score, 100);
});

test("accounts roll up company signals; two kinds beat one", () => {
  const rolled = rollupAccounts([
    sig({ id: "1", kind: "hiring", domain: "attio.com", company: "Attio", score: 40 }),
    sig({ id: "2", kind: "news", domain: "attio.com", score: 20 }),
    sig({ id: "3", kind: "funding", company: "Solo", score: 45 }),
    sig({ id: "4", kind: "intent", author: "u/x", score: 90 }),
  ]);
  assert.equal(rolled.length, 2);
  assert.equal(rolled[0].company, "Attio");
  assert.equal(rolled[0].score, 50);
  assert.deepEqual(rolled[0].kinds, ["hiring", "news"]);
});
