import { describe, expect, it } from "vitest";

import { containsTerm, locationMatches, scorePosting } from "@/lib/market/match";
import {
  adzunaRequest,
  greenhouseRequest,
  jsearchRequest,
  leverRequest,
  parseAdzuna,
  parseGreenhouse,
  parseJSearch,
  parseLever,
} from "@/lib/market/sources";
import { dedupeKey, htmlToText, safeHttpsUrl } from "@/lib/market/text";
import type { NormalizedPosting } from "@/lib/market/types";

// Fixtures follow each provider's documented response shape.
const adzunaFixture = {
  results: [
    {
      id: "4351234567",
      title: "Senior <strong>Network</strong> Engineer",
      description: "Design <strong>BGP</strong> and SD-WAN for a multi-site network…",
      created: "2026-10-29T14:00:00Z",
      redirect_url: "https://www.adzuna.com/details/4351234567",
      company: { display_name: "Lone Star Networks" },
      location: { display_name: "Dallas, Dallas County", area: ["US", "Texas", "Dallas County", "Dallas"] },
      salary_min: 120000,
      salary_max: 150000,
      contract_time: "full_time",
      contract_type: "permanent",
    },
    { id: "bad", title: "No URL" },
    { id: "js", title: "XSS", redirect_url: "javascript:alert(1)" },
  ],
};

const jsearchFixture = {
  status: "OK",
  data: [
    {
      job_id: "abc123==",
      job_title: "Network Engineer III",
      employer_name: "AT&amp;T",
      job_publisher: "Indeed",
      job_apply_link: "https://www.indeed.com/viewjob?jk=abc",
      job_city: "Dallas",
      job_state: "TX",
      job_country: "US",
      job_is_remote: false,
      job_posted_at_datetime_utc: "2026-10-29T10:00:00.000Z",
      job_description: "Support MPLS and BGP across the backbone.",
      job_employment_type: "FULLTIME",
    },
    {
      job_id: "def456",
      job_title: "SOC Analyst",
      employer_name: "Example Health",
      job_publisher: "Dice",
      job_apply_link: "https://www.dice.com/job-detail/def456",
      job_is_remote: true,
      job_posted_at_datetime_utc: "2026-10-28T10:00:00.000Z",
      job_description: "Splunk, incident response.",
    },
  ],
};

const greenhouseFixture = {
  jobs: [
    {
      id: 127817,
      title: "Cloud Platform Engineer",
      updated_at: "2026-10-27T15:51:19-05:00",
      location: { name: "Austin, TX" },
      absolute_url: "https://boards.greenhouse.io/democorp/jobs/127817",
      content: "&lt;p&gt;Build &lt;strong&gt;Kubernetes&lt;/strong&gt; platforms.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
    },
  ],
};

const leverFixture = [
  {
    id: "5ac21346-8e0c-4494-8e7a-3eb92ff77902",
    text: "RF Optimization Engineer",
    categories: { location: "Houston, Texas", commitment: "Full-time", team: "RAN" },
    hostedUrl: "https://jobs.lever.co/democorp/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
    createdAt: Date.UTC(2026, 9, 25),
    descriptionPlain: "Optimize 5G RAN performance.",
    workplaceType: "on-site",
  },
];

describe("source parsers", () => {
  it("parses Adzuna, stripping HTML and dropping records without a safe URL", () => {
    const [p, ...rest] = parseAdzuna(adzunaFixture);
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({
      source: "adzuna",
      externalId: "4351234567",
      title: "Senior Network Engineer",
      companyName: "Lone Star Networks",
      salaryMin: 120000,
      url: "https://www.adzuna.com/details/4351234567",
      postedAt: "2026-10-29T14:00:00.000Z",
    });
    expect(p.description).toBe("Design BGP and SD-WAN for a multi-site network…");
  });

  it("parses JSearch (Indeed/Dice via Google for Jobs) with publisher and remote flag", () => {
    const [att, soc] = parseJSearch(jsearchFixture);
    expect(att).toMatchObject({ companyName: "AT&T", location: "Dallas, TX, US", publisher: "Indeed", isRemote: false });
    expect(soc).toMatchObject({ publisher: "Dice", isRemote: true, location: null });
  });

  it("parses Greenhouse double-encoded HTML into plain text without script content", () => {
    const [p] = parseGreenhouse(greenhouseFixture, "Demo Corp");
    expect(p).toMatchObject({ companyName: "Demo Corp", location: "Austin, TX", externalId: "127817" });
    expect(p.description).toBe("Build Kubernetes platforms.");
  });

  it("parses Lever postings", () => {
    const [p] = parseLever(leverFixture, "Demo Corp");
    expect(p).toMatchObject({ title: "RF Optimization Engineer", location: "Houston, Texas", employmentType: "Full-time", isRemote: false });
    expect(p.postedAt).toBe("2026-10-25T00:00:00.000Z");
  });

  it("returns nothing for unexpected shapes instead of throwing", () => {
    for (const bad of [null, "x", 42, { results: "nope" }, { data: [null, 1] }, [{}]]) {
      expect(parseAdzuna(bad)).toEqual([]);
      expect(parseJSearch(bad)).toEqual([]);
      expect(parseGreenhouse(bad, "X")).toEqual([]);
      expect(parseLever(bad, "X")).toEqual([]);
    }
  });

  it("builds requests without leaking keys into the wrong place and encodes board tokens", () => {
    expect(adzunaRequest({ appId: "id", appKey: "key", what: "network engineer", where: "Texas" }).url).toContain(
      "what=network+engineer&",
    );
    const js = jsearchRequest({ apiKey: "secret", query: "network engineer in Texas" });
    expect(js.url).not.toContain("secret");
    expect(js.headers?.["x-rapidapi-key"]).toBe("secret");
    expect(greenhouseRequest("../admin").url).toBe("https://boards-api.greenhouse.io/v1/boards/..%2Fadmin/jobs?content=true");
    expect(leverRequest("acme").url).toBe("https://api.lever.co/v0/postings/acme?mode=json");
  });
});

describe("sanitizers", () => {
  it("only keeps https URLs", () => {
    expect(safeHttpsUrl("https://jobs.example.com/1")).toBe("https://jobs.example.com/1");
    for (const bad of ["http://x.com", "javascript:alert(1)", "data:text/html,x", "https://localhost/x", 5, null]) {
      expect(safeHttpsUrl(bad)).toBeNull();
    }
  });

  it("converts HTML to readable text", () => {
    expect(htmlToText("<ul><li>BGP</li><li>OSPF</li></ul><style>x{}</style>")).toBe("• BGP\n• OSPF");
    expect(htmlToText("")).toBeNull();
  });

  it("recognizes the same job across boards", () => {
    const a = dedupeKey({ companyName: "AT&T Inc.", title: "Network Engineer III", location: "Dallas, TX" });
    const b = dedupeKey({ companyName: "AT&T", title: "Network Engineer  III", location: "Dallas, TX" });
    expect(a).toBe(b);
  });
});

describe("fit scoring", () => {
  const base: NormalizedPosting = {
    source: "jsearch",
    externalId: "1",
    title: "Senior Network Engineer",
    companyName: "AT&T",
    location: "Dallas, TX",
    isRemote: false,
    employmentType: null,
    salaryMin: null,
    salaryMax: null,
    description: "Own BGP and SD-WAN design. CCNP preferred.",
    url: "https://example.com/1",
    postedAt: null,
  };
  const hunt = {
    keywords: ["network engineer", "BGP", "SD-WAN", "firewall"],
    excludeKeywords: ["intern"],
    locations: ["Texas"],
    includeRemote: true,
    minScore: 3,
  };

  it("scores title and description hits and explains them", () => {
    expect(scorePosting(hunt, base)).toEqual({ matches: true, score: 5, matchedTerms: ["network engineer", "BGP", "SD-WAN"] });
  });

  it("matches state names to abbreviations and vice versa", () => {
    expect(locationMatches("Dallas, TX", "Texas")).toBe(true);
    expect(locationMatches("Austin, Texas", "TX")).toBe(true);
    expect(locationMatches("Austin, Texas, United States", "austin")).toBe(true);
    expect(locationMatches("Denver, CO", "Texas")).toBe(false);
    // "in" in prose is not Indiana.
    expect(locationMatches("Remote in Dallas", "Indiana")).toBe(false);
  });

  it("applies location, remote, exclusion and threshold rules", () => {
    expect(scorePosting(hunt, { ...base, location: "Denver, CO" }).reason).toBe("location");
    expect(scorePosting(hunt, { ...base, location: "Denver, CO", isRemote: true }).matches).toBe(true);
    expect(scorePosting({ ...hunt, includeRemote: false }, { ...base, location: "Denver, CO", isRemote: true }).matches).toBe(false);
    expect(scorePosting(hunt, { ...base, title: "Network Engineer Intern" }).reason).toBe("excluded");
    expect(scorePosting(hunt, { ...base, title: "Systems Administrator", description: "Some BGP exposure." })).toMatchObject({
      matches: false,
      reason: "below_threshold",
      score: 1,
    });
    expect(scorePosting({ ...hunt, locations: [] }, { ...base, location: "Seattle, WA" }).matches).toBe(true);
  });

  it("matches whole words and special terms", () => {
    expect(containsTerm("we use c++ daily", "C++")).toBe(true);
    expect(containsTerm("networking engineer", "network engineer")).toBe(false);
    expect(containsTerm("bgpx routers", "BGP")).toBe(false);
  });
});
