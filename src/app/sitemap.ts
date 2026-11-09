import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";
import { buildSitemap } from "@/lib/seo-routes";
import { createPublicClient } from "@/lib/supabase/public";

export const revalidate = 3600;

const BATCH = 100;
const MAX_JOBS = 1000;

async function publishedJobs(): Promise<{ id: string; published_at: string }[]> {
  const supabase = createPublicClient();
  if (!supabase) return [];

  const jobs: { id: string; published_at: string }[] = [];
  for (let offset = 0; offset < MAX_JOBS; offset += BATCH) {
    const { data, error } = await supabase.rpc("get_published_jobs", { p_limit: BATCH, p_offset: offset });
    if (error || !Array.isArray(data)) {
      if (error) console.error("Sitemap: failed to load jobs", error.message);
      break;
    }
    jobs.push(...data.map((row: { id: string; published_at: string }) => ({ id: row.id, published_at: row.published_at })));
    if (data.length < BATCH) break;
  }
  return jobs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(siteConfig.url, await publishedJobs());
}
