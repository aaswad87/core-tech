import type { MetadataRoute } from "next";

import { specialties } from "@/content/specialties";

/** Every indexable public page. Keep in sync when adding public routes. */
export const PUBLIC_PATHS = [
  "/",
  "/about",
  "/services",
  ...specialties.map((s) => `/services/${s.slug}`),
  "/employers",
  "/candidates",
  "/jobs",
  "/contact",
  "/privacy",
  "/terms",
] as const;

/** Private or utility routes that search engines should not crawl. */
export const DISALLOWED_PATHS = [
  "/admin",
  "/recruiter",
  "/api",
  "/account",
  "/auth",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/access-denied",
  "/offline",
] as const;

export function buildSitemap(
  baseUrl: string,
  jobs: { id: string; published_at: string }[],
): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = PUBLIC_PATHS.map((path) => ({
    url: `${baseUrl}${path === "/" ? "" : path}`,
    changeFrequency: path === "/jobs" ? "daily" : "monthly",
    priority: path === "/" ? 1 : path === "/jobs" ? 0.9 : 0.7,
  }));

  const jobPages: MetadataRoute.Sitemap = jobs.map((job) => ({
    url: `${baseUrl}/jobs/${job.id}`,
    lastModified: job.published_at,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...pages, ...jobPages];
}

/** Non-production Vercel deployments (previews) must not be indexed. */
export function isIndexableDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return !env.VERCEL_ENV || env.VERCEL_ENV === "production";
}

export function buildRobots(baseUrl: string, indexable: boolean): MetadataRoute.Robots {
  if (!indexable) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
