import { Building2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { listMyCompanies } from "@/lib/employer/queries";

export const metadata: Metadata = { title: "Your companies" };

export default async function EmployerHomePage() {
  const user = await requireRole(["employer"], "/employer");
  const companies = await listMyCompanies(user.id);
  if (companies.length === 1) redirect(`/employer/${companies[0].id}`);

  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Employer portal</h1>
      {companies.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          Your account isn&apos;t linked to a company yet. Ask your CoreTech recruiter to add you to your company&apos;s team.
        </p>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">Choose a company.</p>
          <ul className="mt-6 grid gap-3">
            {companies.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/employer/${c.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 hover:border-brand/40 hover:bg-brand-50/40"
                >
                  <Building2Icon className="size-5 text-brand" aria-hidden="true" />
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.is_demo && <Badge variant="outline">Demo data</Badge>}
                  <span className="ml-auto text-sm text-muted-foreground">{c.myRole === "owner" ? "Owner" : "Member"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Container>
  );
}
