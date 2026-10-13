#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { loadPrices, quote, runOnce, type RunResult } from "./engine.ts";
import { loadLogos } from "./logos.ts";
import { LoootClient } from "./looot.ts";
import { csv, emailDrafts, notify, table } from "./output.ts";
import { renderReport } from "./report.ts";
import { planCalls } from "./sources.ts";
import { loadState, prune, saveState } from "./state.ts";
import { usd } from "./util.ts";

const HELP = `looot-signal-listener: buying signals for your ICP, scored with reasons, through one looot key.

Usage
  node src/cli.ts init                 write icp.json from the example
  node src/cli.ts quote                show every call a run makes and its maximum cost (free, no key)
  node src/cli.ts run                  run once, print new signals, save state
  node src/cli.ts report               turn the last run.json into an HTML report (free, no key)
  node src/cli.ts balance              show your looot balance (free, needs LOOOT_TOKEN)

Options
  --config <file>     ICP config (default icp.json)
  --state <file>      state file for dedupe and snapshots (default .signals/state.json)
  --out <dir>         also write run.json, signals.csv, email-drafts.md and report.html into this folder
  --html <file>       write the HTML report to this file (run and report)
  --from <file>       run.json to read for report (default out/run.json)
  --json              print the run as JSON instead of a table
  --csv               print CSV instead of a table
  --new-only          table shows only signals not seen in earlier runs
  --limit <n>         rows in the table (default 25)
  --no-notify         do not post to Slack or the webhook
  --logos <dir>       show company logos in the HTML report: read <dir>/<domain>.png, fetch a missing one from
                      Google's favicon service and cache it there. Without it the report shows names only.
  --label <text>      a pill in the report's top bar, for example "Live run · 2026-10-13"
  --redact            HTML report hides post authors, @handles, emails and phone numbers (for screenshots you share)
  --offline-prices    use the dated prices in src/sources.ts instead of reading the public catalog

Env
  LOOOT_TOKEN         agent token from looot.ai. Without it only Hacker News runs (free).
  SLACK_WEBHOOK_URL   optional Slack incoming webhook (name set in notify.slackWebhookEnv)
  SIGNAL_WEBHOOK_URL  optional generic webhook (name set in notify.webhookEnv)`;

/** Splits argv into a command, flags with values and boolean switches. */
export function parseArgs(argv: string[]): { cmd: string; opts: Record<string, string | true> } {
  const opts: Record<string, string | true> = {};
  let cmd = "";
  const withValue = new Set(["config", "state", "out", "limit", "html", "from", "logos", "label"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) opts[k] = v;
      else if (withValue.has(k) && argv[i + 1] !== undefined) opts[k] = argv[++i];
      else opts[k] = true;
    } else if (!cmd) cmd = a;
  }
  return { cmd: cmd || "help", opts };
}

/** Logos for the watched accounts and the accounts in the run, only when --logos <dir> is given. */
async function logosFor(result: RunResult, config: ReturnType<typeof loadConfig>, opts: Record<string, string | true>): Promise<Record<string, string> | undefined> {
  if (typeof opts.logos !== "string") return undefined;
  return loadLogos([...config.accounts.list.map((a) => a.domain), ...result.accounts.map((a) => a.domain)], resolve(opts.logos), { online: true });
}

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const { cmd, opts } = parseArgs(argv);
  const configPath = resolve(String(opts.config ?? "icp.json"));
  const statePath = resolve(String(opts.state ?? ".signals/state.json"));

  if (cmd === "help" || opts.help) {
    console.log(HELP);
    return 0;
  }

  if (cmd === "init") {
    if (existsSync(configPath)) {
      console.log(`${configPath} already exists, left as is.`);
      return 0;
    }
    const example = join(dirname(fileURLToPath(import.meta.url)), "..", "icp.example.json");
    copyFileSync(example, configPath);
    console.log(`Wrote ${configPath}. Edit product, intent.queries, hiring.titles and accounts.list, then run: node src/cli.ts quote`);
    return 0;
  }

  if (cmd === "balance") {
    if (!env.LOOOT_TOKEN) {
      console.error("LOOOT_TOKEN is not set.");
      return 1;
    }
    console.log(JSON.stringify(await new LoootClient({ token: env.LOOOT_TOKEN, baseUrl: env.LOOOT_API_URL }).balance(), null, 2));
    return 0;
  }

  if (cmd !== "quote" && cmd !== "run" && cmd !== "report") {
    console.error(`Unknown command "${cmd}".\n\n${HELP}`);
    return 1;
  }

  const config = loadConfig(configPath);
  const now = new Date();
  const calls = planCalls(config, now);
  const prices = await loadPrices(calls, { baseUrl: env.LOOOT_API_URL, offline: Boolean(opts["offline-prices"]) });
  const pricesSource = prices.source === "catalog" ? "live public catalog" : `dated fallback (${prices.asOf})`;

  if (cmd === "quote") {
    const q = quote(calls, prices);
    console.log(`Prices: ${pricesSource}`);
    console.log(`${"SOURCE".padEnd(16)}${"CALLS".padEnd(8)}MAX COST`);
    for (const [src, row] of Object.entries(q.bySource)) console.log(`${src.padEnd(16)}${String(row.calls).padEnd(8)}${row.maxMicros ? usd(row.maxMicros) : "free"}`);
    console.log(`\n${q.calls} calls (${q.paidCalls} paid), at most ${usd(q.maxMicros)} per run. Budget cap: ${usd(Math.round(config.budgetUsd * 1e6))}.`);
    if (q.maxMicros > config.budgetUsd * 1e6) console.log("The plan costs more than the budget: the last paid calls will be skipped. Raise budgetUsd or trim queries.");
    if (q.unpriced.length) console.log(`No known price for: ${q.unpriced.join(", ")}. These custom endpoints are not capped by the quote.`);
    console.log("No paid call was made.");
    return 0;
  }

  if (cmd === "report") {
    const from = resolve(String(opts.from ?? "out/run.json"));
    if (!existsSync(from)) {
      console.error(`${from} not found. Run first: node src/cli.ts run --out out`);
      return 1;
    }
    const result = JSON.parse(readFileSync(from, "utf8")) as RunResult;
    const html = resolve(String(opts.html ?? join(dirname(from), "report.html")));
    const logos = await logosFor(result, config, opts);
    writeFileSync(html, renderReport({ result, config, quote: quote(calls, prices), pricesSource, runs: loadState(statePath).runs, logos, redact: Boolean(opts.redact), label: typeof opts.label === "string" ? opts.label : undefined }));
    console.log(`Wrote ${html}`);
    return 0;
  }

  const state = prune(loadState(statePath), now);
  const client = env.LOOOT_TOKEN ? new LoootClient({ token: env.LOOOT_TOKEN, baseUrl: env.LOOOT_API_URL }) : null;
  const result = await runOnce({ config, state, client, prices, now });
  saveState(statePath, state);

  if (opts.out) {
    const dir = resolve(String(opts.out));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(dir, "signals.csv"), csv(result));
    writeFileSync(join(dir, "email-drafts.md"), emailDrafts(result, config));
  }
  const htmlPath = opts.html ? resolve(String(opts.html)) : opts.out ? join(resolve(String(opts.out)), "report.html") : null;
  if (htmlPath) {
    mkdirSync(dirname(htmlPath), { recursive: true });
    const logos = await logosFor(result, config, opts);
    writeFileSync(htmlPath, renderReport({ result, config, quote: quote(calls, prices), pricesSource, runs: state.runs, logos, redact: Boolean(opts.redact), label: typeof opts.label === "string" ? opts.label : undefined }));
  }
  const notes = opts["no-notify"] ? [] : await notify(result, config, env);

  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else if (opts.csv) process.stdout.write(csv(result));
  else {
    console.log(table(result, Number(opts.limit ?? 25), Boolean(opts["new-only"])));
    for (const l of [...result.log, ...notes]) console.error(`  ${l}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}
