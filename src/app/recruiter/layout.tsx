import type { Metadata } from "next";
import { headers } from "next/headers";

import { Container } from "@/components/layout/container";
import { NavLink } from "@/components/layout/nav-link";
import { isAdmin, STAFF_ROLES } from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireRole } from "@/lib/auth/session";
import { PATHNAME_HEADER } from "@/lib/supabase/proxy";

export const metadata: Metadata = {
  title: { default: "Recruiter workspace", template: "%s | Recruiter workspace" },
  robots: { index: false, follow: false },
};

const linkClass =
  "inline-flex h-12 items-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Staff-only area. Every page and action below also checks the role itself; RLS is the final gate. */
export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  // Send people back to the page they asked for after signing in (validated by the login page).
  const requested = safeNextPath((await headers()).get(PATHNAME_HEADER), "/recruiter/candidates");
  const user = await requireRole(STAFF_ROLES, requested.startsWith("/recruiter") ? requested : "/recruiter/candidates");

  return (
    <div className="bg-surface/60 min-h-[calc(100dvh-4rem)]">
      <div className="border-b border-border bg-background">
        <Container>
          <nav aria-label="Recruiter workspace" className="flex gap-6 overflow-x-auto">
            <NavLink href="/recruiter/candidates" className={linkClass} activeClassName="border-brand text-ink">
              Candidates
            </NavLink>
            <NavLink href="/recruiter/jobs" className={linkClass} activeClassName="border-brand text-ink">
              Jobs
            </NavLink>
            <NavLink href="/recruiter/pipeline" className={linkClass} activeClassName="border-brand text-ink">
              Pipeline
            </NavLink>
            <NavLink href="/recruiter/interviews" className={linkClass} activeClassName="border-brand text-ink">
              Interviews
            </NavLink>
            <NavLink href="/recruiter/companies" className={linkClass} activeClassName="border-brand text-ink">
              Companies
            </NavLink>
            <NavLink href="/recruiter/market" className={linkClass} activeClassName="border-brand text-ink">
              Job Radar
            </NavLink>
            {isAdmin(user.roles) && (
              <NavLink href="/recruiter/finance" className={linkClass} activeClassName="border-brand text-ink">
                Finance
              </NavLink>
            )}
            {isAdmin(user.roles) && (
              <NavLink href="/recruiter/contracts" className={linkClass} activeClassName="border-brand text-ink">
                Contracts
              </NavLink>
            )}
            <NavLink href="/recruiter/commissions" className={linkClass} activeClassName="border-brand text-ink">
              Commissions
            </NavLink>
            <NavLink href="/admin/leads" className={linkClass} activeClassName="border-brand text-ink">
              Leads
            </NavLink>
            {isAdmin(user.roles) && (
              <NavLink href="/admin/users" className={linkClass} activeClassName="border-brand text-ink">
                Users
              </NavLink>
            )}
            {isAdmin(user.roles) && (
              <NavLink href="/admin/privacy" className={linkClass} activeClassName="border-brand text-ink">
                Privacy
              </NavLink>
            )}
          </nav>
        </Container>
      </div>
      {children}
    </div>
  );
}
