import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { JsonLd } from "@/components/marketing/json-ld";
import { absoluteUrl } from "@/lib/seo";

export type Crumb = { title: string; href: string };

/** Visible breadcrumb trail plus BreadcrumbList structured data. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const trail = [{ title: "Home", href: "/" }, ...items];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {trail.map((crumb, index) => {
            const isLast = index === trail.length - 1;
            return (
              <li key={crumb.href} className="flex items-center gap-1">
                {isLast ? (
                  <span aria-current="page" className="font-medium text-ink">
                    {crumb.title}
                  </span>
                ) : (
                  <>
                    <Link href={crumb.href} className="hover:text-brand focus-visible:text-brand focus-visible:outline-none">
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
