import { mergeConfig, DEFAULT_CONFIG } from "../src/config.ts";
import type { Config } from "../src/types.ts";

export interface Recorded {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/**
 * A fake fetch. `routes` maps an endpoint id (for looot runs) or a URL prefix (anything else) to a response.
 * A function route gets the parsed body. Every request is recorded; any real network call fails the test.
 */
export function fakeFetch(routes: Record<string, unknown | ((body: Record<string, unknown> | null) => unknown)>, opts: { costUsd?: number | string; status?: Record<string, number> } = {}) {
  const calls: Recorded[] = [];
  let n = 0;
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, method: init?.method ?? "GET", body, headers: (init?.headers ?? {}) as Record<string, string> });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/v1/runs")) {
      const id = String(body?.endpointId);
      const st = opts.status?.[id];
      if (st) return json(st, { error: { code: st === 402 ? "insufficient_funds" : "unauthorized", message: `fake ${st}` } });
      const route = routes[id];
      if (route === undefined) return json(200, { runId: `run_${++n}`, status: "failed", error: { message: `no fake for ${id}` } });
      const result = typeof route === "function" ? (route as (b: unknown) => unknown)(body?.input ?? null) : route;
      return json(200, { runId: `run_${++n}`, status: "completed", result, actualCost: opts.costUsd ?? "0.001" });
    }
    for (const [prefix, route] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return json(200, typeof route === "function" ? (route as (b: unknown) => unknown)(body) : route);
    }
    throw new Error(`unexpected network call in a test: ${url}`);
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** The default config with a patch on top. */
export const cfg = (patch: Record<string, unknown>): Config => mergeConfig(DEFAULT_CONFIG, patch);

export const NOW = new Date("2026-10-12T12:00:00Z");
