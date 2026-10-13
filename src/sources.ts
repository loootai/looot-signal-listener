import type { Config, CustomSource, Kind, Signal } from "./types.ts";
import { at, canonicalUrl, cleanText, hash, hostOf, num, obj, rowsOf, str, toIso, type Obj } from "./util.ts";

/** Endpoint ids, prices and parameter names were read from the free public catalog on this date. */
export const PRICES_AS_OF = "2026-10-13";

/** Every pinned looot endpoint this tool runs, with its dated price. The live catalog price wins when it can be read. */
export const ENDPOINTS = {
  reddit: { id: "scrapecreators-reddit-search", micros: 1880, unit: "call" },
  x: { id: "anyapi-run-twitter-search", micros: 750, unit: "call" },
  news: { id: "serper-news", micros: 1000, unit: "call" },
  jobs: { id: "anyapi-run-linkedin-jobs-thin", micros: 500, unit: "call" },
  funding: { id: "predictleads-discover-financing-events", micros: 10_000, unit: "result" },
  techstack: { id: "tomba-technology", micros: 8900, unit: "call" },
  page: { id: "jina-reader", micros: 200, unit: "call" },
} as const;

/** A signal before the fingerprint and score are added. */
export type Draft = Omit<Signal, "id" | "score" | "reasons">;

/** One call the engine will make. endpointId null means a free source that is not looot (Hacker News Algolia). */
export interface PlannedCall {
  source: string;
  label: string;
  endpointId: string | null;
  input: Record<string, unknown>;
  /** How many billed units the call may use: 1 for per-call prices, the row limit for per-result prices. */
  maxUnits: number;
  /** Fallback price per unit in micros, used when the live catalog cannot be read. */
  fallbackMicros: number;
  parse: (raw: unknown, now: Date) => Draft[];
  /** Free calls go straight to this URL instead of looot. */
  freeUrl?: string;
  /** For diff sources: what the result is stored under in state. */
  snapshotKey?: string;
}

const base = (kind: Kind, source: string, query: string): Draft => ({ kind, source, query, title: "", text: "", url: null, author: null, company: null, domain: null, publishedAt: null, engagement: 0 });

// ---------- parsers (pure, tested offline against fixtures) ----------

/** scrapecreators-reddit-search: { posts: [{ id, title, selftext, permalink, subreddit, author, score, num_comments, created_utc }] }. */
export function parseReddit(raw: unknown, now: Date, query = ""): Draft[] {
  return rowsOf(raw, ["posts", "results", "children"]).flatMap((entry) => {
    const r = entry.data && typeof entry.data === "object" ? obj(entry.data) : entry;
    const title = cleanText(r.title, 300);
    if (!title) return [];
    const permalink = str(r.permalink);
    const author = str(r.author);
    const sub = str(r.subreddit);
    return [{
      ...base("intent", "reddit", query),
      title,
      text: cleanText(r.selftext ?? r.body),
      url: permalink ? (permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`) : str(r.url),
      author: author ? `u/${author}` : null,
      company: sub ? `r/${sub.replace(/^r\//, "")}` : null,
      publishedAt: toIso(r.created_utc ?? r.created, now),
      engagement: num(r.score, r.ups) + num(r.num_comments),
    }];
  });
}

/** anyapi-run-twitter-search: posts under tweets, results, items or posts. Field names vary by provider, so several are tried. */
export function parseX(raw: unknown, now: Date, query = ""): Draft[] {
  return rowsOf(raw, ["tweets", "results", "items", "posts"]).flatMap((r) => {
    const text = cleanText(str(r.text, r.full_text, r.content));
    if (!text) return [];
    const user = obj(r.author ?? r.user);
    const handle = str(user.userName, user.username, user.screen_name, r.username, r.authorUsername);
    const id = str(r.id, r.id_str, r.tweet_id);
    return [{
      ...base("intent", "x", query),
      title: text.slice(0, 140),
      text,
      url: str(r.url, r.twitterUrl) ?? (handle && id ? `https://x.com/${handle}/status/${id}` : null),
      author: handle ? `@${handle}` : str(user.name),
      publishedAt: toIso(r.createdAt ?? r.created_at, now),
      engagement: num(r.likeCount, r.favorite_count, r.likes) + num(r.replyCount, r.reply_count) + num(r.retweetCount, r.retweet_count),
    }];
  });
}

/** Hacker News Algolia search_by_date: { hits: [{ objectID, title, story_text, comment_text, story_title, author, points, num_comments, created_at_i }] }. Free, no key. */
export function parseHn(raw: unknown, now: Date, query = ""): Draft[] {
  return rowsOf(raw, ["hits"]).flatMap((h) => {
    const id = str(h.objectID);
    const isComment = Boolean(h.comment_text);
    const title = isComment ? cleanText(h.story_title, 200) : cleanText(h.title, 300);
    const text = cleanText(h.comment_text ?? h.story_text);
    if (!id || !(title || text)) return [];
    return [{
      ...base("intent", "hn", query),
      title: isComment ? `Comment on: ${title}` : title,
      text,
      url: `https://news.ycombinator.com/item?id=${id}`,
      author: str(h.author),
      company: "Hacker News",
      publishedAt: toIso(h.created_at_i ?? h.created_at, now),
      engagement: num(h.points) + num(h.num_comments),
    }];
  });
}

const COMPANY_VERBS = "raises|raised|secures|secured|lands|closes|closed|announces|appoints|appointed|names|named|hires|hired|promotes|taps|welcomes|adds";
const NEWS_COMPANY = new RegExp(`^(?:exclusive:\\s*)?([A-Z0-9][\\w.&'-]*(?:\\s+[A-Z0-9][\\w.&'-]*){0,3})\\s+(?:${COMPANY_VERBS})\\b`);

/** Best-effort company name from a headline such as "Acme raises $12M". null when the title does not fit. */
export function companyFromHeadline(title: string): string | null {
  const m = NEWS_COMPANY.exec(title.trim());
  return m ? m[1].trim() : null;
}

/** serper-news: { news: [{ title, link, snippet, date, source }] }. */
export function parseNews(kind: Kind, source: string, company: string | null = null, domain: string | null = null) {
  return (raw: unknown, now: Date, query = ""): Draft[] =>
    rowsOf(raw, ["news", "results", "organic"]).flatMap((r) => {
      const title = cleanText(r.title, 300);
      const link = str(r.link, r.url);
      if (!title || !link) return [];
      return [{
        ...base(kind, source, query),
        title,
        text: cleanText([str(r.source), str(r.snippet)].filter(Boolean).join(": ")),
        url: link,
        company: company ?? companyFromHeadline(title),
        domain,
        publishedAt: toIso(r.date ?? r.publishedAt, now),
      }];
    });
}

/** anyapi-run-linkedin-jobs-thin and similar job lists. */
export function parseJobs(raw: unknown, now: Date, query = ""): Draft[] {
  return rowsOf(raw, ["jobs", "items", "results"]).flatMap((r) => {
    const title = cleanText(str(r.title, r.jobTitle, r.job_title, r.position), 200);
    if (!title) return [];
    const co = obj(r.company);
    const company = str(r.companyName, r.company_name, co.name, typeof r.company === "string" ? r.company : null);
    const location = str(r.location, r.jobLocation);
    return [{
      ...base("hiring", "linkedin_jobs", query),
      title: `${company ?? "A company"} is hiring: ${title}`,
      text: [title, company, location].filter(Boolean).join(" | "),
      url: str(r.url, r.jobUrl, r.job_url, r.link),
      company,
      domain: hostOf(str(r.companyDomain, r.company_domain, co.domain, co.website, r.companyWebsite)),
      publishedAt: toIso(r.postedAt ?? r.posted_at ?? r.datePosted ?? r.listedAt ?? r.postedDate, now),
    }];
  });
}

/** predictleads-discover-financing-events: JSON:API rows with an `included` list of companies. */
export function parseFunding(raw: unknown, now: Date, query = ""): Draft[] {
  const o = obj(raw);
  const root = Array.isArray(o.included) ? o : obj(o.data && !Array.isArray(o.data) ? o.data : o);
  const included = Array.isArray(root.included) ? (root.included as unknown[]).map(obj) : [];
  const companies = new Map<string, Obj>();
  for (const c of included) if (typeof c.id === "string") companies.set(c.id, obj(c.attributes));
  return rowsOf(root, ["data"]).flatMap((r) => {
    const a = r.attributes ? obj(r.attributes) : r;
    const relId = str(obj(obj(obj(r.relationships).company).data).id, obj((at(r, "relationships.companies.data") as unknown[] | undefined)?.[0]).id);
    const co = (relId ? companies.get(relId) : undefined) ?? obj(a.company);
    const type = str(a.financing_type_normalized, a.financing_type, a.category);
    const amount = num(a.amount_normalized, a.amount);
    const company = str(co.company_name, co.name, a.company_name);
    if (!type && !company) return [];
    const money = amount > 0 ? ` $${amount.toLocaleString("en-US")}` : "";
    return [{
      ...base("funding", "funding", query),
      title: `${company ?? "A company"} raised${money}${type ? ` (${type.replace(/_/g, " ")})` : ""}`,
      text: cleanText(str(a.summary, a.title) ?? ""),
      url: str(a.url, a.source_url, a.article_url),
      company,
      domain: hostOf(str(co.domain, co.website, a.domain)),
      publishedAt: toIso(a.effective_date ?? a.published_at ?? a.found_at, now),
    }];
  });
}

/** tomba-technology and similar: a list of technologies. Returns lower-case names, sorted, unique. */
export function techNames(raw: unknown): string[] {
  const rows = rowsOf(raw, ["technologies", "technology", "techs", "data", "results"]);
  const names = rows.map((r) => str(r.name, r.technology, r.title, r.slug)).filter((n): n is string => Boolean(n));
  if (names.length === 0) {
    const flat = at(raw, "data");
    if (Array.isArray(flat)) names.push(...flat.filter((x): x is string => typeof x === "string"));
  }
  return [...new Set(names.map((n) => n.trim().toLowerCase()))].sort();
}

/** jina-reader: { data: { content, title } } or plain text. Returns the page as trimmed, non-empty lines. */
export function pageLines(raw: unknown): string[] {
  const content = typeof raw === "string" ? raw : str(at(raw, "data.content"), at(raw, "content"), at(raw, "data.text"), at(raw, "text"), at(raw, "markdown")) ?? "";
  return content
    .split(/\r?\n/)
    .map((l) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 3 && l.length <= 400);
}

/** A custom source parser from the field map in the config. */
export function parseCustom(cs: CustomSource) {
  return (raw: unknown, now: Date, query = ""): Draft[] => {
    const rows = cs.itemsPath ? (Array.isArray(at(raw, cs.itemsPath)) ? (at(raw, cs.itemsPath) as unknown[]).map(obj) : []) : rowsOf(raw, ["results", "items", "data", "posts", "news", "organic"]);
    const f = cs.fields ?? {};
    const get = (r: Obj, field: keyof NonNullable<CustomSource["fields"]>, fallbacks: string[]) => str(...(f[field] ? f[field]!.split("|") : fallbacks).map((p) => at(r, p)));
    return rows.flatMap((r) => {
      const title = cleanText(get(r, "title", ["title", "name", "headline"]), 300);
      const text = cleanText(get(r, "text", ["text", "snippet", "description", "content"]));
      if (!title && !text) return [];
      return [{
        ...base(cs.kind, cs.name, query),
        title: title || text.slice(0, 140),
        text,
        url: get(r, "url", ["url", "link"]),
        author: get(r, "author", ["author", "username"]),
        company: get(r, "company", ["company", "company_name"]),
        domain: hostOf(get(r, "domain", ["domain", "website"])),
        publishedAt: toIso(get(r, "publishedAt", ["date", "published_at", "created_at"]), now),
      }];
    });
  };
}

// ---------- planning ----------

const window = (days: number) => ({
  reddit: days <= 1 ? "day" : days <= 7 ? "week" : days <= 31 ? "month" : "year",
  tbs: days <= 1 ? "qdr:d" : days <= 7 ? "qdr:w" : days <= 31 ? "qdr:m" : "qdr:y",
  // anyapi-run-linkedin-jobs-thin accepts only these three values (a live run on 2026-10-13 rejected "past week").
  jobs: days <= 1 ? "24h" : days <= 7 ? "week" : "month",
});

const fill = (v: unknown, q: string, days: number): unknown =>
  typeof v === "string" ? v.replace(/\{q\}/g, q).replace(/\{days\}/g, String(days)) : Array.isArray(v) ? v.map((x) => fill(x, q, days)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, q, days)])) : v;

/** Every call one run makes, in order. Nothing is fetched here, so a quote costs nothing. */
export function planCalls(c: Config, now: Date): PlannedCall[] {
  const w = window(c.lookbackDays);
  const calls: PlannedCall[] = [];
  const country = c.icp.countries[0];

  if (c.intent.enabled) {
    for (const q of c.intent.queries) {
      if (c.intent.sources.includes("reddit")) calls.push({ source: "reddit", label: q, endpointId: ENDPOINTS.reddit.id, input: { query: q, sort: "new", timeframe: w.reddit, filter: "posts", trim: "true" }, maxUnits: 1, fallbackMicros: ENDPOINTS.reddit.micros, parse: (r, n) => parseReddit(r, n, q) });
      if (c.intent.sources.includes("x")) calls.push({ source: "x", label: q, endpointId: ENDPOINTS.x.id, input: { query: `${q} -filter:retweets`, limit: 20, queryType: "Latest" }, maxUnits: 1, fallbackMicros: ENDPOINTS.x.micros, parse: (r, n) => parseX(r, n, q) });
      if (c.intent.sources.includes("hn")) {
        const since = Math.floor(now.getTime() / 1000) - c.lookbackDays * 86_400;
        const qs = new URLSearchParams({ query: q, tags: "(story,comment)", numericFilters: `created_at_i>${since}`, hitsPerPage: "30" });
        calls.push({ source: "hn", label: q, endpointId: null, input: {}, maxUnits: 0, fallbackMicros: 0, freeUrl: `https://hn.algolia.com/api/v1/search_by_date?${qs}`, parse: (r, n) => parseHn(r, n, q) });
      }
    }
  }

  if (c.hiring.enabled) {
    const location = c.hiring.location ?? country;
    for (const t of c.hiring.titles) calls.push({ source: "linkedin_jobs", label: t, endpointId: ENDPOINTS.jobs.id, input: { query: t, limit: 25, postedLimit: w.jobs, ...(location ? { location } : {}) }, maxUnits: 1, fallbackMicros: ENDPOINTS.jobs.micros, parse: (r, n) => parseJobs(r, n, t) });
  }

  if (c.funding.enabled) {
    if (c.funding.source === "predictleads") {
      const limit = Math.max(1, Math.min(c.funding.limit, 100));
      calls.push({ source: "funding", label: c.funding.stages.join(", ") || "any round", endpointId: ENDPOINTS.funding.id, input: { limit, ...(c.funding.stages.length ? { financing_types_normalized: c.funding.stages.join(",") } : {}), ...(country ? { company_location: country } : {}) }, maxUnits: limit, fallbackMicros: ENDPOINTS.funding.micros, parse: (r, n) => parseFunding(r, n, "funding") });
    } else {
      const stages = c.funding.stages.length ? c.funding.stages.map((s) => `"${s.replace(/_/g, " ")}"`).join(" OR ") : `"seed" OR "Series A" OR "Series B"`;
      const q = `("raises" OR "secures" OR "closes") (${stages})`;
      calls.push({ source: "funding", label: "funding news", endpointId: ENDPOINTS.news.id, input: { q, num: 20, tbs: w.tbs, ...(country ? { gl: country.toLowerCase() } : {}) }, maxUnits: 1, fallbackMicros: ENDPOINTS.news.micros, parse: (r, n) => parseNews("funding", "funding")(r, n, "funding") });
    }
  }

  if (c.leadership.enabled) {
    for (const role of c.leadership.roles) {
      const q = `("appoints" OR "names" OR "hires" OR "promotes") "${role}"`;
      calls.push({ source: "leadership", label: role, endpointId: ENDPOINTS.news.id, input: { q, num: 20, tbs: w.tbs }, maxUnits: 1, fallbackMicros: ENDPOINTS.news.micros, parse: (r, n) => parseNews("leadership", "leadership")(r, n, role) });
    }
  }

  for (const a of c.accounts.list) {
    const domain = hostOf(a.domain);
    if (c.accounts.news) calls.push({ source: "news", label: a.name, endpointId: ENDPOINTS.news.id, input: { q: a.newsQuery || `"${a.name.replace(/"/g, "")}"`, num: 10, tbs: w.tbs }, maxUnits: 1, fallbackMicros: ENDPOINTS.news.micros, parse: (r, n) => parseNews("news", "news", a.name, domain)(r, n, a.name) });
    if (c.accounts.techstack && domain) calls.push({ source: "techstack", label: domain, endpointId: ENDPOINTS.techstack.id, input: { domain }, maxUnits: 1, fallbackMicros: ENDPOINTS.techstack.micros, parse: () => [], snapshotKey: `tech:${domain}` });
    if (c.accounts.website) {
      for (const page of a.pages ?? []) calls.push({ source: "website", label: page, endpointId: ENDPOINTS.page.id, input: { url: page }, maxUnits: 1, fallbackMicros: ENDPOINTS.page.micros, parse: () => [], snapshotKey: `page:${canonicalUrl(page)}` });
    }
  }

  for (const cs of c.custom) {
    if (!cs.enabled) continue;
    const parse = parseCustom(cs);
    for (const q of cs.queries.length ? cs.queries : [""]) calls.push({ source: cs.name, label: q || cs.endpointId, endpointId: cs.endpointId, input: fill(cs.input, q, c.lookbackDays) as Record<string, unknown>, maxUnits: 1, fallbackMicros: 0, parse: (r, n) => parse(r, n, q) });
  }
  return calls;
}

/** Idempotency key for one call: same call in the same UTC day replays instead of charging again. */
export function idempotencyKey(call: PlannedCall, now: Date): string {
  return `lsl-${hash(`${call.endpointId}|${JSON.stringify(call.input)}|${now.toISOString().slice(0, 10)}`)}`;
}
