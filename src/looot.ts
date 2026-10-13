/** Error from the looot API, with the HTTP status and looot's error code when there is one. */
export class LoootError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "LoootError";
    this.status = status;
    this.code = code;
  }
}

export interface LoootRun {
  runId: string;
  status: string;
  result?: unknown;
  actualCost?: number | string | null;
  error?: { code?: string; message?: string } | null;
}

const TERMINAL = new Set(["completed", "failed", "blocked", "stopped"]);

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The part of the client the engine uses. Tests pass a fake fetch instead of a fake client. */
export interface Runner {
  runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun>;
}

/** Small client for the looot REST API: run one pinned endpoint, read a run, read the balance. */
export class LoootClient implements Runner {
  #token: string;
  #base: string;
  #fetch: typeof fetch;
  #pollTimeoutMs: number;
  #pollIntervalMs: number;
  #sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions) {
    this.#token = opts.token;
    this.#base = (opts.baseUrl ?? "https://api.looot.ai").replace(/\/+$/, "");
    this.#fetch = opts.fetch ?? fetch;
    this.#pollTimeoutMs = opts.pollTimeoutMs ?? 60_000;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/json",
        "User-Agent": "looot-signal-listener/0.1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
      throw new LoootError(err?.message ?? `looot returned HTTP ${res.status}`, res.status, err?.code);
    }
    return json as T;
  }

  /**
   * Paid. Runs one pinned endpoint with no provider fallback, so the price is the quoted one.
   * The same idempotency key replays the stored run and is not charged twice.
   */
  async runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun> {
    let run = await this.#request<LoootRun>("POST", "/v1/runs?wait=30", { endpointId, input, idempotencyKey });
    const deadline = Date.now() + this.#pollTimeoutMs;
    while (!TERMINAL.has(run.status) && Date.now() < deadline) {
      await this.#sleep(this.#pollIntervalMs);
      run = await this.#request<LoootRun>("GET", `/v1/runs/${encodeURIComponent(run.runId)}`);
    }
    return run;
  }

  /** Free. The prepaid balance as looot returns it. */
  balance(): Promise<unknown> {
    return this.#request("GET", "/v1/balance");
  }
}

/** Free, no token. Current price of one endpoint from the public catalog, in micros, or null. */
export async function publicPrice(endpointId: string, opts: { baseUrl?: string; fetch?: typeof fetch } = {}): Promise<{ micros: number; unit: string } | null> {
  const base = (opts.baseUrl ?? "https://api.looot.ai").replace(/\/+$/, "");
  try {
    const res = await (opts.fetch ?? fetch)(`${base}/v1/public-catalog/${encodeURIComponent(endpointId)}`);
    if (!res.ok) return null;
    const item = (await res.json()) as { price?: { state?: string; amountMicros?: number; unit?: string } | null };
    const p = item.price;
    if (!p || p.state !== "known" || typeof p.amountMicros !== "number" || p.amountMicros < 0) return null;
    return { micros: Math.round(p.amountMicros), unit: p.unit ?? "call" };
  } catch {
    return null;
  }
}
