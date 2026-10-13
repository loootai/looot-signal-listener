export type Kind = "intent" | "hiring" | "funding" | "leadership" | "news" | "tech_change" | "website_change";

/** One finding, before and after scoring. */
export interface Signal {
  /** Fingerprint used for dedupe across runs and sources. */
  id: string;
  kind: Kind;
  /** Where it came from: reddit, x, hn, linkedin_jobs, news, funding, techstack, website, or a custom source name. */
  source: string;
  title: string;
  text: string;
  url: string | null;
  /** Person or handle, for social posts. */
  author: string | null;
  company: string | null;
  domain: string | null;
  publishedAt: string | null;
  engagement: number;
  /** The query, title, domain or page that produced it. */
  query: string;
  /** Extra facts a scorer can use, for example the tech added or removed. */
  facts?: { added?: string[]; removed?: string[]; addedLines?: string[] };
  score?: number;
  reasons?: Reason[];
}

export interface Reason {
  points: number;
  why: string;
}

export interface Account {
  name: string;
  domain: string | null;
  pages?: string[];
  /** Google News query for this account. Default is the quoted name; set it when the name is a common word (Clay, Exa). */
  newsQuery?: string;
}

/** The whole ICP and listener config, read from icp.json. */
export interface Config {
  /** One line: what you sell and to whom. Shown in outputs and drafts. */
  product: string;
  lookbackDays: number;
  /** Hard cap on looot spend per run, in dollars. */
  budgetUsd: number;
  minScore: number;
  icp: {
    /** Words that say the author or company fits your buyer, for example "saas", "b2b", "shopify". */
    personaWords: string[];
    countries: string[];
  };
  rules: {
    pain: Record<string, number>;
    intent: Record<string, number>;
    negative: Record<string, number>;
  };
  intent: { enabled: boolean; sources: Array<"reddit" | "x" | "hn">; queries: string[] };
  hiring: { enabled: boolean; titles: string[]; location?: string };
  funding: { enabled: boolean; source: "news" | "predictleads"; stages: string[]; limit: number };
  leadership: { enabled: boolean; roles: string[] };
  accounts: {
    list: Account[];
    news: boolean;
    techstack: boolean;
    website: boolean;
    /** Tech that marks a good fit when added, for example your integration partners. */
    watchTech: string[];
    /** Competitor tech. Added or removed, it is a strong signal. */
    competitorTech: string[];
    /** Words on a watched page worth a bonus when they newly appear, for example "enterprise" or "SOC 2". */
    pageKeywords: string[];
  };
  custom: CustomSource[];
  notify: {
    minScore: number;
    /** Names of env vars that hold webhook URLs. URLs never live in this file. */
    slackWebhookEnv: string;
    webhookEnv: string;
  };
}

/** Any looot catalog endpoint as an extra source. "{q}" in input values is replaced by each query. */
export interface CustomSource {
  name: string;
  enabled: boolean;
  kind: Kind;
  endpointId: string;
  input: Record<string, unknown>;
  queries: string[];
  /** Dotted path to the array of rows. Empty means "find the first array". */
  itemsPath?: string;
  /** Signal field -> dotted path in a row. "a|b" tries a then b. */
  fields?: Partial<Record<"title" | "text" | "url" | "author" | "company" | "domain" | "publishedAt", string>>;
}
