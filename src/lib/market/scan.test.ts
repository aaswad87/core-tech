import { describe, expect, it } from "vitest";

import { parseMarketConfig } from "@/lib/market/config";
import { escapeSlack, renderDigestEmail, renderSlackMessage } from "@/lib/market/notify";
import { type DeliveryLog, type MarketRepo, planRequests, runMarketScan, SCAN_LIMITS } from "@/lib/market/scan";
import type { Hunt, NormalizedPosting, WatchCompany } from "@/lib/market/types";

const hunt: Hunt = {
  id: "hunt-1",
  name: "Texas network roles",
  keywords: ["network engineer", "BGP"],
  excludeKeywords: ["intern"],
  locations: ["Texas"],
  includeRemote: true,
  sources: ["jsearch", "greenhouse"],
  minScore: 3,
};

function fakeRepo(opts: { hunts?: Hunt[]; companies?: WatchCompany[]; subscribers?: string[]; recentRun?: boolean } = {}) {
  const state = {
    postings: new Map<string, { id: string; dedupeKey: string; posting: NormalizedPosting }>(),
    matches: new Map<string, { id: string; huntId: string; postingId: string }>(),
    deliveries: [] as DeliveryLog[],
    notified: [] as string[],
    runs: [] as { id: string; status?: string; errors?: unknown[] }[],
  };
  let n = 0;
  const repo: MarketRepo = {
    getOrganizationId: async () => "org-1",
    hasRunSince: async () => opts.recentRun ?? false,
    startRun: async () => {
      const id = `run-${state.runs.length + 1}`;
      state.runs.push({ id });
      return id;
    },
    finishRun: async (id, status, _stats, errors) => {
      Object.assign(state.runs.find((r) => r.id === id)!, { status, errors });
    },
    listActiveHunts: async () => opts.hunts ?? [hunt],
    listWatchCompanies: async () => opts.companies ?? [],
    upsertPostings: async (_org, postings) =>
      postings.map((p) => {
        const key = `${p.source}:${p.externalId}`;
        if (!state.postings.has(key)) state.postings.set(key, { id: `post-${++n}`, dedupeKey: p.dedupeKey, posting: p });
        return state.postings.get(key)!;
      }),
    matchedDedupeKeys: async (huntId, keys) => {
      const matched = [...state.matches.values()].filter((m) => m.huntId === huntId).map((m) => m.postingId);
      return new Set(
        [...state.postings.values()].filter((p) => matched.includes(p.id) && keys.includes(p.dedupeKey)).map((p) => p.dedupeKey),
      );
    },
    insertMatches: async (_org, rows) =>
      rows.flatMap((r) => {
        const key = `${r.huntId}:${r.postingId}`;
        if (state.matches.has(key)) return [];
        const m = { id: `match-${++n}`, huntId: r.huntId, postingId: r.postingId };
        state.matches.set(key, m);
        return [m];
      }),
    listSubscribers: async (huntIds) => (opts.subscribers ?? ["r@coretech.test"]).flatMap((email) => huntIds.map((huntId) => ({ huntId, userId: email, email }))),
    markNotified: async (ids) => {
      state.notified.push(...ids);
    },
    touchHunts: async () => {},
    logDelivery: async (_org, _run, log) => {
      state.deliveries.push(log);
    },
  };
  return { repo, state };
}

const jsearchBody = {
  data: [
    {
      job_id: "j1",
      job_title: "Network Engineer III",
      employer_name: "AT&T",
      job_publisher: "Indeed",
      job_apply_link: "https://www.indeed.com/viewjob?jk=1",
      job_city: "Dallas",
      job_state: "TX",
      job_description: "BGP and MPLS.",
    },
    {
      // Same job reposted on Dice — must not alert twice.
      job_id: "j2",
      job_title: "Network Engineer III",
      employer_name: "AT&T Inc.",
      job_publisher: "Dice",
      job_apply_link: "https://www.dice.com/job-detail/1",
      job_city: "Dallas",
      job_state: "TX",
      job_description: "BGP and MPLS.",
    },
    { job_id: "j3", job_title: "Network Engineer Intern", employer_name: "X", job_apply_link: "https://x.com/1", job_city: "Austin", job_state: "TX" },
    { job_id: "j4", job_title: "Pastry Chef", employer_name: "Bakery", job_apply_link: "https://bake.com/1", job_city: "Austin", job_state: "TX" },
  ],
};

function fakeFetch(handlers: { jsearch?: () => Response; greenhouse?: () => Response; resend?: () => Response; slack?: () => Response }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://jsearch.p.rapidapi.com")) return handlers.jsearch?.() ?? Response.json(jsearchBody);
    if (url.startsWith("https://boards-api.greenhouse.io")) return handlers.greenhouse?.() ?? Response.json({ jobs: [] });
    if (url === "https://api.resend.com/emails") return handlers.resend?.() ?? Response.json({ id: "email-123" });
    if (url.startsWith("https://hooks.slack.com")) return handlers.slack?.() ?? new Response("ok");
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
  return { fn, calls };
}

const config = parseMarketConfig({
  JSEARCH_RAPIDAPI_KEY: "rapid-secret-key",
  RESEND_API_KEY: "re_test",
  MARKET_ALERTS_FROM: "CoreTech Radar <radar@coretech.example>",
});

describe("runMarketScan", () => {
  it("matches new postings once per job, emails a digest, and logs the provider-confirmed delivery", async () => {
    const { repo, state } = fakeRepo();
    const http = fakeFetch({});
    const result = await runMarketScan({ repo, config, fetchImpl: http.fn, appUrl: "https://coretech.example", trigger: "schedule" });

    expect(result.status).toBe("succeeded");
    if (result.status === "skipped") throw new Error("unexpected");
    expect(result.stats).toMatchObject({ postings: 4, newMatches: 1, emailsSent: 1 });

    const email = http.calls.find((c) => c.url === "https://api.resend.com/emails")!;
    const body = JSON.parse(String(email.init!.body));
    expect(body.to).toEqual(["r@coretech.test"]);
    expect(body.subject).toContain("AT&T");
    expect((email.init!.headers as Record<string, string>)["Idempotency-Key"]).toBe("run-1:r@coretech.test");
    expect(state.deliveries).toEqual([
      expect.objectContaining({ channel: "email", status: "sent", providerMessageId: "email-123" }),
    ]);
    expect(state.notified).toHaveLength(1);
  });

  it("does not alert again for postings seen in an earlier scan", async () => {
    const { repo, state } = fakeRepo();
    const http = fakeFetch({});
    await runMarketScan({ repo, config, fetchImpl: http.fn, appUrl: "https://x.test", trigger: "schedule" });
    const second = await runMarketScan({ repo, config, fetchImpl: http.fn, appUrl: "https://x.test", trigger: "schedule" });
    expect(second.status !== "skipped" && second.stats.newMatches).toBe(0);
    expect(state.deliveries).toHaveLength(1);
  });

  it("keeps going when one source fails, reports a partial run, and never stores API keys in errors", async () => {
    const companies: WatchCompany[] = [{ id: "c1", companyName: "Demo Corp", source: "greenhouse", boardToken: "democorp" }];
    const { repo, state } = fakeRepo({ companies });
    const http = fakeFetch({
      greenhouse: () => {
        throw new Error("connect failed rapid-secret-key");
      },
    });
    const result = await runMarketScan({ repo, config, fetchImpl: http.fn, appUrl: "https://x.test", trigger: "manual" });
    expect(result.status).toBe("partial");
    if (result.status === "skipped") throw new Error("unexpected");
    expect(result.stats.newMatches).toBe(1);
    expect(JSON.stringify(state.runs)).not.toContain("rapid-secret-key");
    expect(result.errors[0]).toMatchObject({ source: "greenhouse", target: "Demo Corp" });
  });

  it("records a failed email instead of pretending it was sent", async () => {
    const { repo, state } = fakeRepo();
    const http = fakeFetch({ resend: () => Response.json({ message: "Domain not verified" }, { status: 403 }) });
    const result = await runMarketScan({ repo, config, fetchImpl: http.fn, appUrl: "https://x.test", trigger: "schedule" });
    expect(result.status !== "skipped" && result.stats.emailsSent).toBe(0);
    expect(state.deliveries[0]).toMatchObject({ status: "failed", error: "Resend HTTP 403: Domain not verified" });
    expect(state.notified).toHaveLength(0);
  });

  it("logs skipped email when Resend isn't configured, and posts to Slack when a webhook is set", async () => {
    const { repo, state } = fakeRepo();
    const http = fakeFetch({});
    const slackOnly = parseMarketConfig({
      JSEARCH_RAPIDAPI_KEY: "k",
      SLACK_MARKET_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/XXXX",
    });
    await runMarketScan({ repo, config: slackOnly, fetchImpl: http.fn, appUrl: "https://x.test", trigger: "schedule" });
    expect(state.deliveries.map((d) => `${d.channel}:${d.status}`)).toEqual(["email:skipped", "slack:sent"]);
    expect(state.notified).toHaveLength(1);
  });

  it("skips when another scan just ran", async () => {
    const { repo } = fakeRepo({ recentRun: true });
    const result = await runMarketScan({ repo, config, fetchImpl: fakeFetch({}).fn, appUrl: "https://x.test", trigger: "manual" });
    expect(result.status).toBe("skipped");
  });
});

describe("planRequests", () => {
  it("caps aggregator queries and only calls configured sources", () => {
    const big: Hunt = { ...hunt, keywords: Array.from({ length: 25 }, (_, i) => `kw${i}`), locations: ["Texas", "Ohio", "Utah", "Iowa"] };
    const jobs = planRequests([big], [], config);
    expect(jobs.every((j) => j.source === "jsearch")).toBe(true);
    expect(jobs).toHaveLength(Math.min(SCAN_LIMITS.queriesPerAggregator, SCAN_LIMITS.keywordsPerHunt * SCAN_LIMITS.locationsPerHunt));
    expect(planRequests([hunt], [], parseMarketConfig({}))).toEqual([]);
  });
});

describe("alert rendering", () => {
  const item = {
    matchId: "m1",
    huntName: "Hunt <b>",
    title: '<img src=x onerror="alert(1)">Network Engineer',
    companyName: "AT&T",
    location: "Dallas, TX",
    isRemote: false,
    publisher: "Indeed",
    score: 5,
    matchedTerms: ["BGP"],
  };

  it("escapes job data in emails", () => {
    const { html, subject, text } = renderDigestEmail([item], "https://coretech.example");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("https://coretech.example/recruiter/market/m1");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).toContain("https://coretech.example/recruiter/market/m1");
  });

  it("escapes job data in Slack so it can't inject mentions or links", () => {
    expect(escapeSlack("<!channel> & <https://evil|click>")).toBe("&lt;!channel&gt; &amp; &lt;https://evil|click&gt;");
    expect(renderSlackMessage([{ ...item, title: "<!here> Engineer" }], "https://x.test").text).not.toContain("<!here>");
  });
});

describe("parseMarketConfig", () => {
  it("rejects half-configured or malformed settings", () => {
    expect(() => parseMarketConfig({ ADZUNA_APP_ID: "x" })).toThrow();
    expect(() => parseMarketConfig({ RESEND_API_KEY: "re_x" })).toThrow();
    expect(() => parseMarketConfig({ SLACK_MARKET_WEBHOOK_URL: "https://evil.test/hook" })).toThrow();
    expect(() => parseMarketConfig({ CRON_SECRET: "short" })).toThrow();
    expect(parseMarketConfig({})).toEqual({ adzuna: null, jsearch: null, email: null, slackWebhookUrl: null, cronSecret: null });
  });
});
