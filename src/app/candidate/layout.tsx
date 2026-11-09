import type { Metadata } from "next";
import { headers } from "next/headers";

import { Container } from "@/components/layout/container";
import { NavLink } from "@/components/layout/nav-link";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireRole } from "@/lib/auth/session";
import { PATHNAME_HEADER } from "@/lib/supabase/proxy";

export const metadata: Metadata = {
  title: { default: "Candidate portal", template: "%s | Candidate portal" },
  robots: { index: false, follow: false },
};

const linkClass =
  "inline-flex h-12 shrink-0 items-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Candidate-only area. Pages and actions check the role again; RLS and the database functions are the final gate. */
export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const requested = safeNextPath((await headers()).get(PATHNAME_HEADER), "/candidate");
  await requireRole(["candidate"], requested.startsWith("/candidate") ? requested : "/candidate");

  return (
    <div className="bg-surface/60 min-h-[calc(100dvh-4rem)]">
      <div className="border-b border-border bg-background">
        <Container>
          <nav aria-label="Candidate portal" className="flex gap-6 overflow-x-auto">
            <NavLink href="/candidate" exact className={linkClass} activeClassName="border-brand text-ink">
              Overview
            </NavLink>
            <NavLink href="/candidate/profile" className={linkClass} activeClassName="border-brand text-ink">
              Profile &amp; resume
            </NavLink>
            <NavLink href="/candidate/preferences" className={linkClass} activeClassName="border-brand text-ink">
              Preferences
            </NavLink>
            <NavLink href="/candidate/privacy" className={linkClass} activeClassName="border-brand text-ink">
              Privacy
            </NavLink>
            <NavLink href="/jobs" className={linkClass} activeClassName="border-brand text-ink">
              Find jobs
            </NavLink>
          </nav>
        </Container>
      </div>
      {children}
    </div>
  );
}
