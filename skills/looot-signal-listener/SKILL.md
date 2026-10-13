---
name: looot-signal-listener
description: Find buying signals for the user's ICP (people asking for help on Reddit, X and Hacker News, companies hiring, raising, changing leaders, changing tech stack or changing a web page), scored with reasons, through one looot key. Use when the user asks to find leads, intent signals, trigger events, or "who needs what we sell right now".
---

# looot-signal-listener

A zero-dependency Node CLI in this repo. One run reads `icp.json`, makes the calls it lists through
looot, dedupes against `.signals/state.json`, scores every signal with reasons and prints the best.

## Steps

1. If `icp.json` is missing, run `node src/cli.ts init`, then interview the user and fill it in:
   `product` (one line), `intent.queries` (2 to 4 words each, in the buyer's own words),
   `rules.pain` and `rules.intent` (phrases with points), `hiring.titles`, `leadership.roles`,
   `accounts.list` (name, domain, pages to watch), `accounts.competitorTech`.
2. Run `node src/cli.ts quote`. It is free and makes no paid call. Tell the user the maximum cost
   and the budget cap (`budgetUsd`). Do not run until they agree to that number.
3. Run `node src/cli.ts run --json --out out` with `LOOOT_TOKEN` in the environment.
   Without a token only Hacker News runs.
4. Read `out/run.json`. Present the top signals with their `reasons`, and the `accounts` rollup.
   `out/email-drafts.md` holds drafts for new signals at `notify.minScore` or above. Nothing is sent.
5. If most results are noise, tune `rules` (add negatives, raise `minScore`) and run again. A rerun
   on the same UTC day replays the same looot calls by idempotency key and is not charged twice.

## Rules

- Never put a token or webhook URL in `icp.json`. The config validator refuses it.
- Never raise `budgetUsd` without the user's yes.
- For a one-off question about a single company, the looot MCP tools (`news_search`,
  `company_tech_stack`, `read_web_page`) are faster than a full run.
