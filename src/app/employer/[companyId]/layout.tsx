import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { NavLink } from "@/components/layout/nav-link";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { getMyCompany, listMyCompanies } from "@/lib/employer/queries";

const linkClass =
  "inline-flex h-12 shrink-0 items-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Company-scoped employer pages. Unknown companies and companies the user isn't a member of are a 404. */
export default async function EmployerCompanyLayout({ children, params }: LayoutProps<"/employer/[companyId]">) {
  const { companyId } = await params;
  const user = await requireRole(["employer"], `/employer/${companyId}`);
  if (!idSchema.safeParse(companyId).success) notFound();
  const company = await getMyCompany(user.id, companyId);
  if (!company) notFound();
  const companyCount = (await listMyCompanies(user.id)).length;
  const base = `/employer/${companyId}`;

  return (
    <>
      <div className="border-b border-border bg-background">
        <Container>
          <div className="flex flex-wrap items-center gap-3 pt-5">
            <h1 className="text-xl font-semibold text-ink">{company.name}</h1>
            {company.is_demo && <Badge variant="outline">Demo data</Badge>}
            {companyCount > 1 && (
              <Link href="/employer" className="text-sm text-muted-foreground hover:text-foreground">
                Switch company
              </Link>
            )}
          </div>
          <nav aria-label="Employer portal" className="flex gap-6 overflow-x-auto">
            <NavLink href={base} exact className={linkClass} activeClassName="border-brand text-ink">
              Jobs &amp; candidates
            </NavLink>
            <NavLink href={`${base}/requests`} className={linkClass} activeClassName="border-brand text-ink">
              Job requests
            </NavLink>
            <NavLink href={`${base}/timesheets`} className={linkClass} activeClassName="border-brand text-ink">
              Timesheets
            </NavLink>
            <NavLink href={`${base}/company`} className={linkClass} activeClassName="border-brand text-ink">
              Company &amp; team
            </NavLink>
          </nav>
        </Container>
      </div>
      {children}
    </>
  );
}
