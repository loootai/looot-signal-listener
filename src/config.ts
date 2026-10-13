import { readFileSync } from "node:fs";
import type { Config } from "./types.ts";

/** Defaults for every field, so an icp.json only needs what it changes. */
export const DEFAULT_CONFIG: Config = {
  product: "",
  lookbackDays: 7,
  budgetUsd: 0.25,
  minScore: 15,
  icp: { personaWords: [], countries: [] },
  rules: {
    pain: {},
    intent: {
      "looking for": 10,
      "any recommendations": 10,
      "recommend a": 8,
      "alternative to": 12,
      "switching from": 12,
      "anyone tried": 6,
      "need help": 10,
      "how do i": 5,
      "willing to pay": 12,
      budget: 5,
    },
    negative: {
      "i built": -8,
      "check out my": -10,
      "we just launched": -6,
      giveaway: -15,
      airdrop: -20,
      "open to work": -15,
      "who is hiring": -30,
      "seeking work": -20,
    },
  },
  intent: { enabled: true, sources: ["reddit", "x", "hn"], queries: [] },
  hiring: { enabled: false, titles: [] },
  funding: { enabled: false, source: "news", stages: [], limit: 20 },
  leadership: { enabled: false, roles: [] },
  accounts: { list: [], news: true, techstack: false, website: false, watchTech: [], competitorTech: [], pageKeywords: [] },
  custom: [],
  notify: { minScore: 40, slackWebhookEnv: "SLACK_WEBHOOK_URL", webhookEnv: "SIGNAL_WEBHOOK_URL" },
};

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return (patch === undefined ? base : patch) as T;
  if (!base || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    // Rule tables are replaced whole when given, so a user can drop a default phrase.
    out[k] = k === "pain" || k === "intent" || k === "negative" ? v : merge(out[k], v);
  }
  return out as T;
}

/** Problems that would make a run spend money for nothing. Empty means the config is usable. */
export function validate(c: Config): string[] {
  const errs: string[] = [];
  if (!(c.budgetUsd >= 0)) errs.push("budgetUsd must be a number >= 0");
  if (!(c.lookbackDays >= 1 && c.lookbackDays <= 365)) errs.push("lookbackDays must be between 1 and 365");
  if (c.intent.enabled && c.intent.queries.length === 0) errs.push("intent is enabled but intent.queries is empty");
  if (c.hiring.enabled && c.hiring.titles.length === 0) errs.push("hiring is enabled but hiring.titles is empty");
  if (c.leadership.enabled && c.leadership.roles.length === 0) errs.push("leadership is enabled but leadership.roles is empty");
  if ((c.accounts.techstack || c.accounts.website) && c.accounts.list.length === 0) errs.push("accounts.techstack or accounts.website is on but accounts.list is empty");
  for (const a of c.accounts.list) if (!a.name) errs.push("every account needs a name");
  for (const s of c.custom) if (s.enabled && !s.endpointId) errs.push(`custom source ${s.name || "(unnamed)"} has no endpointId`);
  const secretish = /hooks\.slack\.com|https?:\/\/[^"]*token=|lt_[A-Za-z0-9]{16,}/;
  if (secretish.test(JSON.stringify(c))) errs.push("the config looks like it holds a secret or webhook URL; put it in an env var and name the var in notify.*Env");
  return errs;
}

/** Reads icp.json, fills defaults and validates. Throws with every problem listed. */
export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const c = merge(DEFAULT_CONFIG, raw);
  const errs = validate(c);
  if (errs.length > 0) throw new Error(`${path} has problems:\n- ${errs.join("\n- ")}`);
  return c;
}

export { merge as mergeConfig };
