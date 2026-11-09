import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";
import { buildRobots, isIndexableDeployment } from "@/lib/seo-routes";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteConfig.url, isIndexableDeployment());
}
