# looot-signal-listener compared with lead-signal-listener

[yangyixxxx/lead-signal-listener](https://github.com/yangyixxxx/lead-signal-listener) (MIT, by newmax.ai) is a local Python app that finds people describing a problem on Reddit, X, LinkedIn, Facebook, Instagram, Hacker News and RSS. It runs its paid sources through one Treg token, scores posts with phrase rules, stores them in SQLite and shows them in a web UI.

This file compares it with looot-signal-listener as of 2026-10-13. Everything below about theirs comes from reading their code and README at that date. Nothing of theirs was run. Nothing of ours has had a live paid run either, so neither side's result quality is compared here.

## Short version

They are good at one thing: finding posts where a person describes a problem, then letting you review and track those people in a UI.

Ours is better at a second thing: noticing that a company changed (tech stack, a web page, a new leader, news), tying several signals to one account, explaining every score point, and pushing the result to Slack, a webhook or email drafts on a schedule with no server running.

If you mostly want social posts and a lead inbox, theirs is the better tool today. If you watch a list of accounts and want to hear when one of them moves, ours does things theirs does not.

## Feature by feature

| | lead-signal-listener | looot-signal-listener |
|---|---|---|
| Language, deps | Python 3.10+, no third-party deps | Node 22.18+, no deps (Node runs the TypeScript directly) |
| Key | One Treg token | One looot token |
| Free mode without a key | Hacker News, RSS, import | Hacker News only |
| Reddit, X, Hacker News posts | Yes | Yes |
| LinkedIn posts, Facebook posts and groups, Instagram | Yes, built in | No. Only through a custom source you map yourself |
| RSS feeds | Yes | No |
| Paging | Up to 10 pages per keyword, with cursors | One page per query |
| Hiring | LinkedIn jobs | LinkedIn jobs |
| Funding | GetLeads funding feed, billed per result | Google News query ($0.001 a call), or PredictLeads, billed per result |
| Leadership changes | No | Yes, from news |
| News about a watched account | Via a custom Google News source | Yes, built in per account |
| Tech stack changes | No | Yes, diff against the last snapshot |
| Website page changes | No | Yes, line diff against the last snapshot |
| Any catalog endpoint as a source | Yes, with UI catalog search | Yes, in the config file, no catalog search |
| Scoring | Phrase rules for pain, intent, persona, negative; plus engagement and a question bonus | The same kind of phrase rules, plus account list, competitor and watched tech, page keywords, recency |
| Score explained | Matched phrases are stored | Every point has a reason line with its points |
| Persona label | Yes (picks the best-matching persona) | No label. Persona words add points |
| Account rollup | No, each post stands alone | Yes, company signals grouped, more kinds score higher |
| Dedupe | Per source and provider id | Across sources by canonical URL, and across runs |
| Lead workflow | Status (new, qualified, contacted, replied, ignored), notes, filters | None |
| UI | Local web UI, English and Chinese | Terminal table only |
| Outputs | UI, CSV and JSON export, local JSON API | Table, JSON, CSV, Slack, generic webhook, email drafts |
| Cost shown before a run | No | Yes, `quote` lists every call and the maximum cost from live catalog prices |
| Spend caps | Per-call cap enforced by Treg, per-run budget | Per-run budget checked before each call; pinned endpoints with no fallback routing |
| Repeat runs not billed twice | Same query within an hour, by idempotency key | Same call on the same UTC day, by idempotency key |
| Stops on bad token or empty balance | Yes | Yes |
| Schedule | In-app scheduler while the server runs, or `--run-once` from cron | Shipped GitHub Action with state in the Actions cache, or cron |
| Agent setup | AGENT_SETUP.md, a long interview playbook | A short Claude Code skill |
| Tests | 5 Python test files | 38 tests, all HTTP faked |
| Size | About 1,570 lines of Python plus a 62 KB HTML UI | About 1,300 lines of TypeScript plus 500 lines of tests |
| Proven on real data | Yes. README shows a real run: 284 leads for $0.073 | No. Fixtures only. The looot catalog marks every paid response shape used here as unverified |
| Stars, activity | 62 stars, 5 forks, 19 commits, all on 2026-10-10 | Not published |

## Setup time

Neither was timed with a stopwatch. These are the steps.

Theirs: clone, `python app.py`, open the browser, paste a Treg token, pick sources and keywords in the UI, click Run. Their agent prompt can do the keyword interview for you.

Ours: clone, `node src/cli.ts init`, edit `icp.json` in an editor, `node src/cli.ts quote`, set `LOOOT_TOKEN`, `node src/cli.ts run`. The skill file lets Claude Code do the interview and fill the JSON.

Both need one account with a prepaid balance. Theirs is faster for someone who does not want to edit JSON. Ours is faster to put on a schedule, because the workflow file is already written.

## Cost per 100 leads

What counts as a lead differs between the two, so a single number would mislead. Here is what can be checked.

Per-call prices on the sources both have (theirs from their README, ours from the looot public catalog on 2026-10-13):

| Source | Treg (theirs) | looot (ours) |
|---|---|---|
| Reddit search, Scrape Creators | $0.002 | $0.00188 |
| X search | $0.00075 to $0.015, routed | $0.00075, AnyAPI pinned |
| LinkedIn jobs, AnyAPI | $0.0005 | $0.0005 |

On the overlap the prices are close to equal. Neither side has a real price advantage there.

Their one measured run: 284 leads for $0.073, so about $0.026 per 100 leads, counting every post at score 10 or more. That is their number, not ours.

Ours has no measured number. Per 100 raw rows at full pages, before scoring: X about $0.004 (20 per call), LinkedIn jobs about $0.002 (25 per call), Google News $0.005 to $0.01 (10 to 20 per call), Reddit about $0.027 (their README says a page holds about 7 posts). How many of those rows clear your `minScore` depends on your queries. In a free test against live Hacker News with the example config, 32 rows came back and none cleared score 15, which is the filter doing its job on off-topic comments, and also a reminder that the yield is unknown until a paid run.

Account watching costs per account, not per lead: $0.0089 per tech stack check and $0.0002 per page check, each run. Watching 50 accounts daily on tech and one page each is about $0.46 a day.

## Where theirs wins

- A real UI with a lead inbox. You can mark leads contacted, add notes, filter and rescore. Ours has none of that.
- More social sources out of the box: LinkedIn posts, Facebook posts and groups, Instagram hashtags and reels. Ours covers those only if you write the field map yourself.
- Paging. They fetch up to 10 pages per keyword. We fetch one, so a busy keyword returns fewer posts.
- Free RSS and import. Google Alerts, subreddit feeds and leads from other tools come in at no cost.
- Proven parsers. Their screenshots come from a real run. Our paid parsers have only been tested against fixtures built from docs and sibling tools.
- A server-side per-call price cap from Treg. Ours relies on pinned endpoints and a client-side budget check.
- English and Chinese UI.
- A larger catalog by their count (3,800+ Treg endpoints, against about 2,500 on looot).
- They exist in public with users. We do not.

## Where ours wins

- Company-level triggers theirs does not have: tech stack changes, website changes, leadership changes and per-account news.
- Account rollup. Three small signals at one company show up as one account worth calling.
- Every score point has a reason you can read and argue with.
- Pushes results out: Slack, any webhook, email drafts. Theirs waits for you to open the UI.
- A quote before any spend, with live catalog prices.
- Cross-source dedupe by canonical URL, so one article found two ways is one signal.
- A ready GitHub Action, so it runs daily with no machine on.

## What would close the gaps

In order of value: one live paid run to verify the parsers and measure leads per dollar (under $0.05 with the example config); paging for Reddit and X; a LinkedIn posts source; a lead status field in the state file. A UI is the largest gap and the most work.
