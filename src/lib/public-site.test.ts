import { describe, expect, it } from "vitest";

import { isActivePath } from "@/components/layout/nav-link";
import { footerNav, mainNav } from "@/config/site";
import { specialties } from "@/content/specialties";
import { jobsHref, parseJobSearch } from "@/lib/jobs/public-jobs";
import { buildRobots, buildSitemap, DISALLOWED_PATHS, isIndexableDeployment, PUBLIC_PATHS } from "@/lib/seo-routes";

describe("parseJobSearch", () => {
  it("normalizes untrusted params", () => {
    expect(parseJobSearch({ q: "  network  ", arrangement: "remote", page: "3" })).toEqual({
      query: "network",
      arrangement: "remote",
      page: 3,
    });
    expect(parseJobSearch({ arrangement: "moon", page: "-4" })).toEqual({ query: "", arrangement: null, page: 1 });
    expect(parseJobSearch({ page: "abc" }).page).toBe(1);
    expect(parseJobSearch({ page: "999999" }).page).toBe(1000);
    expect(parseJobSearch({ q: "x".repeat(500) }).query).toHaveLength(100);
    expect(parseJobSearch({ q: ["a", "b"] }).query).toBe("a");
  });

  it("builds filter-preserving links", () => {
    const search = { query: "soc analyst", arrangement: "hybrid" as const, page: 2 };
    expect(jobsHref(search)).toBe("/jobs?q=soc+analyst&arrangement=hybrid&page=2");
    expect(jobsHref(search, { page: 1 })).toBe("/jobs?q=soc+analyst&arrangement=hybrid");
    expect(jobsHref({ query: "", arrangement: null, page: 1 })).toBe("/jobs");
  });
});

describe("navigation", () => {
  it("only links to public pages that exist", () => {
    const links = [...mainNav, ...footerNav.flatMap((g) => g.items)].map((i) => i.href);
    for (const href of links) expect(PUBLIC_PATHS as readonly string[]).toContain(href);
  });

  it("covers every page the phase requires", () => {
    for (const path of ["/", "/about", "/services", "/employers", "/candidates", "/jobs", "/contact", "/privacy", "/terms"]) {
      expect(PUBLIC_PATHS as readonly string[]).toContain(path);
    }
    expect(specialties.map((s) => s.slug).sort()).toEqual(
      ["cloud", "cybersecurity", "it-recruiting", "networking", "telecommunications"].sort(),
    );
  });

  it("marks nested routes active", () => {
    expect(isActivePath("/services/cloud", "/services")).toBe(true);
    expect(isActivePath("/servicesx", "/services")).toBe(false);
    expect(isActivePath("/jobs", "/")).toBe(false);
  });
});

describe("sitemap and robots", () => {
  it("lists public pages and published jobs but no private routes", () => {
    const sitemap = buildSitemap("https://coretech.example", [{ id: "abc", published_at: "2026-10-01T00:00:00Z" }]);
    const urls = sitemap.map((e) => e.url);
    expect(urls).toContain("https://coretech.example");
    expect(urls).toContain("https://coretech.example/services/networking");
    expect(urls).toContain("https://coretech.example/jobs/abc");
    for (const path of DISALLOWED_PATHS) expect(urls.some((u) => u.includes(path))).toBe(false);
  });

  it("blocks crawling of private routes and of preview deployments", () => {
    const prod = buildRobots("https://coretech.example", true);
    expect(prod.sitemap).toBe("https://coretech.example/sitemap.xml");
    expect(JSON.stringify(prod.rules)).toContain("/admin");
    expect(buildRobots("https://coretech.example", false).rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(isIndexableDeployment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isIndexableDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isIndexableDeployment({})).toBe(true);
  });
});
