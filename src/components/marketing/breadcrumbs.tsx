import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { JsonLd } from "@/components/marketing/json-ld";
import { absoluteUrl } from "@/lib/seo";
import { cn } from "@/lib/utils";

export type Crumb = { title: string; href: string };

/** Visible breadcrumb trail plus BreadcrumbList structured data. */
export function Breadcrumbs({ items, tone = "light" }: { items: Crumb[]; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  const trail = [{ title: "Home", href: "/" }, ...items];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className={cn("flex flex-wrap items-center gap-1 text-sm", dark ? "text-white/60" : "text-muted-foreground")}>
          {trail.map((crumb, index) => {
            const isLast = index === trail.length - 1;
            return (
              <li key={crumb.href} className="flex items-center gap-1">
                {isLast ? (
                  <span aria-current="page" className={cn("font-medium", dark ? "text-white" : "text-ink")}>
                    {crumb.title}
                  </span>
                ) : (
                  <>
                    <Link
                      href={crumb.href}
                      className={cn(
                        "focus-visible:outline-none",
                        dark ? "hover:text-brand-400 focus-visible:text-brand-400" : "hover:text-brand focus-visible:text-brand",
                      )}
                    >
                      {crumb.title}
                    </Link>
                    <ChevronRightIcon className="size-3.5" aria-hidden="true" />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.title,
            item: absoluteUrl(crumb.href),
          })),
        }}
      />
    </>
  );
}
