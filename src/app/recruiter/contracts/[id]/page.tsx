import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AssignmentForm,
  AssignmentStatusButtons,
  ContractInvoiceForm,
  PayrollStatusForm,
  StaffReviewForm,
  TimesheetForm,
  WarningList,
} from "@/components/contracts/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { idSchema } from "@/lib/candidates/validation";
import { getAssignment, getAssignmentOptions } from "@/lib/contracts/queries";
import {
  ASSIGNMENT_STATUS,
  assignmentWarnings,
  EMPLOYMENT_MODELS,
  exposureWarning,
  labelOf,
  NOT_PAYROLL_NOTICE,
  PAYROLL_STATUS,
  recentMondays,
  TIMESHEET_STATUS,
} from "@/lib/contracts/validation";
import { INVOICE_STATUS, usd } from "@/lib/finance/validation";

export const metadata: Metadata = { title: "Assignment" };

function Panel({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export default async function AssignmentPage({ params }: PageProps<"/recruiter/contracts/[id]">) {
  const { id } = await params;
  await requireRole(["admin"], `/recruiter/contracts/${id}`);
  if (!idSchema.safeParse(id).success) notFound();
  const [detail, options] = await Promise.all([getAssignment(id), getAssignmentOptions()]);
  if (!detail) notFound();

  const { assignment: a, timesheets, totals } = detail;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const editable = a.status === "pending" || a.status === "active";
  const canLog = a.status === "active" || a.status === "ended";
  const approvedWeeks = new Set(timesheets.filter((t) => t.status === "approved").map((t) => t.week_start));
  const weeks = recentMondays(a.start_date, a.end_date).filter((w) => !approvedWeeks.has(w)).map((w) => ({ value: w, label: `Week of ${w}` }));
  const uninvoiced = timesheets.filter((t) => t.status === "approved" && !t.invoice_id);
  const warnings = [
    ...assignmentWarnings({
      billRate: Number(a.bill_rate),
      payRate: Number(a.pay_rate),
      burdenPercent: Number(a.burden_percent),
      clientTermsDays: a.client_payment_terms_days,
      payFrequency: a.worker_pay_frequency,
      employmentModel: a.employment_model,
    }),
    ...(totals ? [exposureWarning(totals.exposure, totals.billing)].filter((w): w is NonNullable<typeof w> => Boolean(w)) : []),
  ];

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <Link href="/recruiter/contracts" className="text-sm text-muted-foreground hover:text-foreground">
          ← Contract staffing
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
          {a.candidates ? fullName(a.candidates) : "Worker"} · {a.title}
          <Badge variant="outline">{labelOf(ASSIGNMENT_STATUS, a.status)}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {a.companies?.name} · {labelOf(EMPLOYMENT_MODELS, a.employment_model)} · {a.start_date}
          {a.end_date ? ` to ${a.end_date}` : " (no end date)"}
        </p>
        <div className="mt-3">
          <AssignmentStatusButtons assignmentId={a.id} status={a.status} />
        </div>
      </div>

      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{NOT_PAYROLL_NOTICE}</p>

      {totals && (
        <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Approved hours", totals.approved_hours.toLocaleString("en-US")],
              ["Billing", usd(totals.billing)],
              ["Gross pay", usd(totals.gross_pay)],
              ["Spread", usd(totals.spread)],
              ["Est. burden", usd(totals.est_burden)],
              ["Cash exposure", usd(totals.exposure)],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-background p-3">
              <p className="text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}
      <WarningList warnings={warnings} />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <Panel id="timesheets" title="Timesheets" description="Clients approve weeks in their portal. You can also record an approval they gave by email.">
            {timesheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No timesheets yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {timesheets.map((t) => (
                  <li key={t.id} className="grid gap-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">Week of {t.week_start}</span>
                      <Badge variant={t.status === "approved" ? "secondary" : "outline"}>{labelOf(TIMESHEET_STATUS, t.status)}</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {Number(t.regular_hours)} h{Number(t.overtime_hours) > 0 && ` + ${Number(t.overtime_hours)} h OT`} · bill {usd(t.billing)} · pay {usd(t.gross_pay)} · spread{" "}
                      {usd(Number(t.billing) - Number(t.gross_pay))} · est. burden {usd((Number(t.gross_pay) * Number(t.burden_percent)) / 100)}
                    </p>
                    {t.notes && <p className="text-xs text-muted-foreground">Note: {t.notes}</p>}
                    {t.rejection_reason && t.status === "rejected" && <p className="text-xs text-destructive">Client: {t.rejection_reason}</p>}
                    {t.status === "approved" && (
                      <p className="text-xs text-muted-foreground">
                        Approved {t.approved_by_kind === "client" ? "by the client in the portal" : `— ${t.approval_note}`}
                        {t.invoices && (
                          <>
                            {" · "}
                            <Link href={`/recruiter/finance/invoices/${t.invoice_id}`} className="text-brand hover:underline">
                              {t.invoices.invoice_number}
                            </Link>{" "}
                            ({labelOf(INVOICE_STATUS, t.invoices.status)})
                          </>
                        )}
                      </p>
                    )}
                    {t.status === "submitted" && <StaffReviewForm assignmentId={a.id} timesheetId={t.id} />}
                    {t.status === "approved" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Payroll: {labelOf(PAYROLL_STATUS, t.payroll_status)}</span>
                        <PayrollStatusForm assignmentId={a.id} timesheetId={t.id} status={t.payroll_status} reference={t.payroll_reference} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canLog ? (
              <details open={timesheets.length === 0}>
                <summary className="cursor-pointer text-sm font-medium text-brand">Enter or correct a week</summary>
                <div className="mt-3">
                  <TimesheetForm assignmentId={a.id} weeks={weeks} />
                </div>
              </details>
            ) : (
              <p className="text-sm text-muted-foreground">Mark the assignment active to enter timesheets.</p>
            )}
          </Panel>

          {uninvoiced.length > 0 && (
            <Panel id="invoice" title="Invoice the client" description="Creates a draft invoice from the approved weeks you pick. Send it from Finance.">
              <ContractInvoiceForm
                assignmentId={a.id}
                today={today}
                due={addDays(today, a.client_payment_terms_days)}
                weeks={uninvoiced.map((t) => ({ id: t.id, label: `Week of ${t.week_start}`, billing: Number(t.billing) }))}
              />
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-6">
          {editable ? (
            <Panel id="terms" title="Terms" description="Rate changes apply to weeks entered from now on.">
              <AssignmentForm
                workers={options.workers}
                clients={options.clients}
                locked={timesheets.length > 0}
                values={{
                  assignmentId: a.id,
                  candidateId: a.candidate_id,
                  companyId: a.company_id,
                  title: a.title,
                  employmentModel: a.employment_model,
                  startDate: a.start_date,
                  endDate: a.end_date ?? "",
                  billRate: String(a.bill_rate),
                  payRate: String(a.pay_rate),
                  otBillMultiplier: String(a.ot_bill_multiplier),
                  otPayMultiplier: String(a.ot_pay_multiplier),
                  burdenPercent: String(a.burden_percent),
                  clientTermsDays: String(a.client_payment_terms_days),
                  payFrequency: a.worker_pay_frequency,
                  notes: a.notes ?? "",
                }}
              />
            </Panel>
          ) : (
            <Panel id="terms" title="Terms">
              <p className="text-sm">
                {usd(a.bill_rate)}/h bill · {usd(a.pay_rate)}/h pay · {Number(a.burden_percent)}% est. burden · net {a.client_payment_terms_days} terms
              </p>
            </Panel>
          )}
        </div>
      </div>
    </Container>
  );
}
