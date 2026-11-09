import type { Metadata } from "next";

import { siteConfig } from "@/config/site";

type PageMetaInput = {
  title: string;
  description: string;
  /** Path beginning with "/". Used for the canonical URL. */
  path: string;
  noIndex?: boolean;
};

/** Consistent title, description, canonical URL and Open Graph data for a public page. */
export function pageMetadata({ title, description, path, noIndex }: PageMetaInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: `${title} | ${siteConfig.name}`,
      description,
      url: path,
    },
    twitter: { card: "summary_large_image", title: `${title} | ${siteConfig.name}`, description },
    ...(noIndex ? { robots: { index: false, follow: true } } : {}),
  };
}

export function absoluteUrl(path: string): string {
  return `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
}
