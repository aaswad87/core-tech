import { TriangleAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { WarningList } from "@/components/contracts/forms";
import { Container } from "@/components/layout/container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getContractOverview } from "@/lib/contracts/queries";
import { ASSIGNMENT_STATUS, assignmentWarnings, exposureWarning, labelOf, NOT_PAYROLL_NOTICE } from "@/lib/contracts/validation";
import { usd } from "@/lib/finance/validation";

export const metadata: Metadata = { title: "Contract staffing" };

export default async function ContractsPage() {
  await requireRole(["admin"], "/recruiter/contracts");
  const { rows, error } = await getContractOverview();
  const sum = (k: "billing" | "gross_pay" | "spread" | "est_burden" | "net_margin" | "uninvoiced_billing" | "exposure") => rows.reduce((s, r) => s + r[k], 0);
  const totalExposure = exposureWarning(sum("exposure"), sum("billing"));
  const waiting = rows.reduce((s, r) => s + r.pending_approval, 0);

  return (
    <Container className="grid gap-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Contract staffing</h1>
          <p className="mt-2 text-muted-foreground">Assignments, timesheets, client approvals and contract invoices. Administrators only.</p>
        </div>
        <Button asChild>
          <Link href="/recruiter/contracts/new">New assignment</Link>
        </Button>
      </div>

      <Alert className="border-amber-300 bg-amber-50 text-amber-950">
        <TriangleAlertIcon />
        <AlertTitle>Not a payroll system</AlertTitle>
        <AlertDescription className="text-amber-950">{NOT_PAYROLL_NOTICE}</AlertDescription>
      </Alert>

      {error ? (
        <p role="alert" className="text-sm text-destructive">The contract totals couldn&apos;t be loaded. Please refresh the page.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ["Billing", sum("billing"), "Approved hours × bill rates — what clients owe."],
                ["Worker gross pay", sum("gross_pay"), "Approved hours × pay rates, before deductions."],
                ["Gross spread", sum("spread"), "Billing minus gross pay."],
                ["Est. employer burden", sum("est_burden"), "An estimate. Confirm real costs with your payroll provider."],
                ["Net margin (est.)", sum("net_margin"), "Spread minus estimated burden."],
              ] as const
            ).map(([label, value, help]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-xl tabular-nums">{usd(value)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{help}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <p className="rounded-lg border border-border bg-background p-3">
              <span className="text-muted-foreground">Approved but not invoiced:</span> <strong className="tabular-nums">{usd(sum("uninvoiced_billing"))}</strong>
            </p>
            <p className="rounded-lg border border-border bg-background p-3">
              <span className="text-muted-foreground">Cash exposure (worker cost not yet paid for by clients):</span>{" "}
              <strong className="tabular-nums">{usd(sum("exposure"))}</strong>
            </p>
            <p className="rounded-lg border border-border bg-background p-3">
              <span className="text-muted-foreground">Weeks waiting for client approval:</span> <strong>{waiting}</strong>
            </p>
          </div>
          {totalExposure && <WarningList warnings={[totalExposure]} />}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contract assignments yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const warnings = [
                  ...assignmentWarnings({
                    billRate: r.bill_rate,
                    payRate: r.pay_rate,
                    burdenPercent: r.burden_percent,
                    clientTermsDays: r.client_payment_terms_days,
                    payFrequency: r.worker_pay_frequency,
                    employmentModel: r.employment_model,
                  }).filter((w) => w.level !== "info"),
                  ...[exposureWarning(r.exposure, r.billing)].filter((w): w is NonNullable<typeof w> => Boolean(w) && w!.level !== "info"),
                ];
                return (
                  <li key={r.assignment_id} className="grid gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link href={`/recruiter/contracts/${r.assignment_id}`} className="font-medium text-brand hover:underline">
                          {r.worker_name} · {r.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {r.company_name} · {usd(r.bill_rate)}/h bill · {usd(r.pay_rate)}/h pay · from {r.start_date}
                          {r.end_date && ` to ${r.end_date}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {r.pending_approval > 0 && <Badge variant="outline">{r.pending_approval} awaiting approval</Badge>}
                        <span className="tabular-nums">{usd(r.billing)} billed</span>
                        <Badge variant={r.status === "active" ? "secondary" : "outline"}>{labelOf(ASSIGNMENT_STATUS, r.status)}</Badge>
                      </div>
                    </div>
                    {warnings.length > 0 && <WarningList warnings={warnings} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
