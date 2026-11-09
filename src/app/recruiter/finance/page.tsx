import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { getFinanceOverview, listPlacementCandidates } from "@/lib/finance/queries";
import { BUCKETS, INVOICE_STATUS, labelOf, PLACEMENT_STATUS, usd } from "@/lib/finance/validation";
import { stageLabel } from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Finance" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function range(from: unknown, to: unknown, today: string) {
  const year = today.slice(0, 4);
  return {
    from: typeof from === "string" && ISO_DATE.test(from) ? from : `${year}-01-01`,
    to: typeof to === "string" && ISO_DATE.test(to) ? to : `${year}-12-31`,
  };
}

export default async function FinancePage({ searchParams }: PageProps<"/recruiter/finance">) {
  await requireRole(["admin"], "/recruiter/finance");
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const { from, to } = range(params.from, params.to, today);
  const [{ summary, summaryError, placements, invoices, paid }, toRecord] = await Promise.all([getFinanceOverview(from, to), listPlacementCandidates()]);

  const buckets = [
    { key: "forecast", label: "Forecast", value: summary.forecast },
    { key: "earned", label: "Earned", value: summary.earned },
    { key: "invoiced", label: "Invoiced", value: summary.invoiced },
    { key: "collected", label: "Collected", value: summary.collected },
  ] as const;

  return (
    <Container className="grid gap-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Finance</h1>
          <p className="mt-2 text-muted-foreground">Direct-hire placements, invoices, payments and commissions. Administrators only.</p>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm" aria-label="Date range">
          <label className="grid gap-1">
            From
            <input type="date" name="from" defaultValue={from} className="h-9 rounded-lg border border-input bg-background px-2" />
          </label>
          <label className="grid gap-1">
            To
            <input type="date" name="to" defaultValue={to} className="h-9 rounded-lg border border-input bg-background px-2" />
          </label>
          <button type="submit" className="h-9 rounded-full border border-input px-4 font-medium hover:bg-muted">
            Apply
          </button>
        </form>
      </div>

      {summaryError ? (
        <p role="alert" className="text-sm text-destructive">The totals couldn&apos;t be loaded. Please refresh the page.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {buckets.map((b) => (
              <Card key={b.key}>
                <CardHeader>
                  <CardDescription>{b.label}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{usd(b.value)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{BUCKETS[b.key]}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <p className="rounded-lg border border-border bg-background p-3">
              <span className="text-muted-foreground">Outstanding (all invoices not yet paid):</span> <strong className="tabular-nums">{usd(summary.outstanding)}</strong>
            </p>
            <p className="rounded-lg border border-border bg-background p-3">
              <span className="text-muted-foreground">Fees still in a guarantee period:</span> <strong className="tabular-nums">{usd(summary.at_risk)}</strong>
            </p>
            <p className="rounded-lg border border-border bg-background p-3">
              <span className="text-muted-foreground">Refunds owed, not yet paid:</span> <strong className="tabular-nums">{usd(summary.refunds_owed)}</strong>
            </p>
          </div>
        </>
      )}

      {toRecord.length > 0 && (
        <Card className="border-brand/30">
          <CardHeader>
            <CardTitle className="text-lg">Offers and hires without a placement record</CardTitle>
            <CardDescription>Record the agreed fee so it shows up in forecast and earned.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {toRecord.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {a.candidates ? fullName(a.candidates) : "Candidate"} · {a.jobs?.title}
                    {a.jobs?.companies?.name && ` · ${a.jobs.companies.name}`} <span className="text-muted-foreground">({stageLabel(a.stage)})</span>
                  </span>
                  <Link href={`/recruiter/finance/placements/new?application=${a.id}`} className="text-brand hover:underline">
                    Record placement
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Placements</CardTitle>
        </CardHeader>
        <CardContent>
          {placements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No placements yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Candidate</th>
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Start</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Fee</th>
                    <th className="py-2 font-medium">Guarantee ends</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {placements.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-4">
                        <Link href={`/recruiter/finance/placements/${p.id}`} className="font-medium text-brand hover:underline">
                          {p.candidates ? fullName(p.candidates) : "Candidate"}
                        </Link>
                        <div className="text-xs text-muted-foreground">{p.jobs?.title}</div>
                      </td>
                      <td className="py-2 pr-4">{p.companies?.name}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{p.start_date}</td>
                      <td className="py-2 pr-4">{labelOf(PLACEMENT_STATUS, p.status)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{usd(p.fee_amount)}</td>
                      <td className="py-2 whitespace-nowrap">{p.status === "started" ? p.guarantee_ends_on : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invoices and credit notes</CardTitle>
          <CardDescription>Create them from a placement.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Number</th>
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Due</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Amount</th>
                    <th className="py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((i) => {
                    const balance = Number(i.amount) - (paid.get(i.id) ?? 0);
                    const overdue = (i.status === "sent" || i.status === "partially_paid") && i.due_date < today && i.kind === "invoice";
                    return (
                      <tr key={i.id}>
                        <td className="py-2 pr-4">
                          <Link href={`/recruiter/finance/invoices/${i.id}`} className="font-medium text-brand hover:underline">
                            {i.invoice_number}
                          </Link>
                          {i.kind === "credit_note" && <span className="ml-1 text-xs text-muted-foreground">credit note</span>}
                        </td>
                        <td className="py-2 pr-4">{i.companies?.name}</td>
                        <td className={cn("py-2 pr-4 whitespace-nowrap", overdue && "font-medium text-destructive")}>
                          {i.due_date}
                          {overdue && " · overdue"}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={i.status === "paid" ? "secondary" : "outline"}>{labelOf(INVOICE_STATUS, i.status)}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{usd(i.amount)}</td>
                        <td className="py-2 text-right tabular-nums">{i.status === "void" || i.status === "draft" ? "—" : usd(balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
