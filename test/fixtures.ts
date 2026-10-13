/**
 * Response bodies shaped like the provider docs and the parsers in looot-mentions and looot-signals.
 * None of these were captured from a live looot run: the catalog marks these endpoints "unverified".
 */
const T = Math.floor(Date.parse("2026-10-12T12:00:00Z") / 1000);

export const reddit = {
  success: true,
  posts: [
    { id: "r1", title: "Our cold emails are landing in spam, any recommendations?", selftext: "B2B SaaS, 3 SDRs, open rates dropped from 40% to 9% this month.", permalink: "/r/sales/comments/r1/x/", subreddit: "sales", author: "growthpm", score: 40, num_comments: 22, created_utc: T },
    { id: "r2", title: "I built a free email warmup tool, check out my launch", selftext: "giveaway inside", permalink: "/r/SaaS/comments/r2/y/", subreddit: "SaaS", author: "maker", score: 3, num_comments: 1, created_utc: T },
  ],
};

export const x = {
  tweets: [
    { id: "x1", text: "Looking for an alternative to lemlist, our domain reputation tanked and everything is going to spam", author: { userName: "revops_jane" }, likeCount: 12, replyCount: 9, createdAt: "Sun Oct 11 09:00:00 +0000 2026" },
    { id: "x2", text: "nice weather today", author: { userName: "someone" }, likeCount: 0, createdAt: "Sun Oct 11 09:00:00 +0000 2026" },
  ],
};

export const hn = {
  hits: [
    { objectID: "h1", title: "Ask HN: How do I fix email deliverability for outbound?", story_text: "We are a b2b startup, emails going to spam", author: "pg_fan", points: 15, num_comments: 30, created_at_i: T },
    { objectID: "h2", comment_text: "We switched from Instantly and our bounce rate dropped", story_title: "Cold email in 2026", author: "c1", points: 0, created_at_i: T },
  ],
};

export const jobs = {
  data: [
    { title: "SDR Manager", companyName: "Acme Analytics", location: "New York, NY", url: "https://www.linkedin.com/jobs/view/111", postedAt: "2026-10-11" },
    { title: "Head of Sales Development", company: { name: "Attio", domain: "attio.com" }, location: "Remote", url: "https://www.linkedin.com/jobs/view/222", postedAt: "2 days ago" },
  ],
};

export const fundingNews = {
  news: [
    { title: "Rocketlane raises $24M Series A to grow its outbound team", link: "https://techcrunch.com/2026/10/10/rocketlane-raises?utm_source=x", snippet: "The B2B SaaS company will hire SDRs", date: "2026-10-10", source: "TechCrunch" },
  ],
};

export const leadershipNews = {
  news: [
    { title: "Northwind appoints Maria Lopez as VP of Sales", link: "https://example.com/northwind-vp-sales", snippet: "Lopez joins from a b2b saas leader", date: "1 day ago", source: "PR Newswire" },
  ],
};

export const accountNews = {
  news: [
    { title: "Linear launches enterprise plan", link: "https://example.com/linear-enterprise", snippet: "Linear adds SOC 2 and SSO", date: "2026-10-09", source: "The Verge" },
    // Same article as the funding query, reached through another search: must dedupe.
    { title: "Rocketlane raises $24M Series A to grow its outbound team", link: "https://techcrunch.com/2026/10/10/rocketlane-raises/", snippet: "", date: "2026-10-10", source: "TechCrunch" },
  ],
};

export const predictleads = {
  data: [{ id: "f1", type: "financing_event", attributes: { financing_type_normalized: "series_a", amount_normalized: 12000000, effective_date: "2026-10-08", url: "https://example.com/acme-a" }, relationships: { companies: { data: [{ id: "c1", type: "company" }] } } }],
  included: [{ id: "c1", type: "company", attributes: { company_name: "Acme Analytics", domain: "acme.io" } }],
};

export const techBefore = { data: [{ name: "HubSpot" }, { name: "Lemlist" }, { name: "Cloudflare" }] };
export const techAfter = { data: [{ name: "HubSpot" }, { name: "Cloudflare" }, { name: "Salesforce" }] };

export const pageBefore = { code: 200, data: { title: "Pricing", content: "# Pricing\nStarter $10\nTeam $20\nContact us" } };
export const pageAfter = { code: 200, data: { title: "Pricing", content: "# Pricing\nStarter $10\nTeam $20\nEnterprise: SSO, SOC 2 and audit logs\nContact us" } };
