import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CommissionForm,
  CommissionRowActions,
  InvoiceForm,
  PlacementStatusForm,
  PlacementTermsForm,
  ReplacementForm,
} from "@/components/finance/forms";
import { FormMessage } from "@/components/forms/form-message";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { idSchema } from "@/lib/candidates/validation";
import { getPlacement } from "@/lib/finance/queries";
import { COMMISSION_STATUS, INVOICE_STATUS, labelOf, PLACEMENT_STATUS, RESOLUTIONS, usd } from "@/lib/finance/validation";

export const metadata: Metadata = { title: "Placement" };

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

export default async function PlacementPage({ params, searchParams }: PageProps<"/recruiter/finance/placements/[id]">) {
  const { id } = await params;
  await requireRole(["admin"], `/recruiter/finance/placements/${id}`);
  if (!idSchema.safeParse(id).success) notFound();
  const detail = await getPlacement(id);
  if (!detail) notFound();
  const { notice } = await searchParams;

  const { placement: p, invoices, payments, commissions, staff, otherPlacements } = detail;
  const name = p.candidates ? fullName(p.candidates) : "Candidate";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const closed = p.status === "fell_off" || p.status === "cancelled";
  const paidOn = (invoiceId: string) => payments.filter((x) => x.invoice_id === invoiceId).reduce((s, x) => s + Number(x.amount), 0);
  const billed = invoices.filter((i) => i.kind === "invoice" && i.status !== "void").reduce((s, i) => s + Number(i.amount), 0);
  const creditable = invoices.filter((i) => i.kind === "invoice" && i.status !== "draft" && i.status !== "void");
  const splitTotal = commissions.reduce((s, c) => s + Number(c.split_percent), 0);

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <Link href="/recruiter/finance" className="text-sm text-muted-foreground hover:text-foreground">
          ← Finance
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
          {name}
          <Badge variant="outline">{labelOf(PLACEMENT_STATUS, p.status)}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/recruiter/candidates/${p.candidate_id}`} className="text-brand hover:underline">
            Candidate record
          </Link>{" "}
          · {p.jobs?.title} · {p.companies?.name}
        </p>
      </div>
      {notice === "created" && <FormMessage state={{ status: "success", message: "Placement recorded." }} />}

      <div className="grid gap-4 text-sm sm:grid-cols-4">
        {[
          ["Fee", usd(p.fee_amount)],
          ["Refund owed", usd(p.refund_amount)],
          ["Invoiced (excl. void)", usd(billed)],
          [p.status === "started" ? "Guarantee ends" : "Start date", p.status === "started" ? p.guarantee_ends_on : p.start_date],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-background p-3">
            <p className="text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <Panel id="invoices" title="Invoices">
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/recruiter/finance/invoices/${i.id}`} className="font-medium text-brand hover:underline">
                      {i.invoice_number}
                      {i.kind === "credit_note" && " (credit note)"}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{usd(i.amount)}</span>
                      <Badge variant="outline">{labelOf(INVOICE_STATUS, i.status)}</Badge>
                      {i.status !== "draft" && i.status !== "void" && <span className="text-xs text-muted-foreground">paid {usd(paidOn(i.id))}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {p.status !== "cancelled" && (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand">New invoice</summary>
                <div className="mt-3">
                  <InvoiceForm
                    placementId={p.id}
                    kind="invoice"
                    defaults={{
                      amount: String(Math.max(0, Number(p.fee_amount) - billed) || p.fee_amount),
                      issueDate: today,
                      dueDate: addDays(today, 30),
                      description: `Direct-hire placement fee — ${name}, ${p.jobs?.title ?? "role"} (start ${p.start_date})`,
                    }}
                  />
                </div>
              </details>
            )}
            {creditable.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand">New credit note (refund)</summary>
                <div className="mt-3">
                  <InvoiceForm
                    placementId={p.id}
                    kind="credit_note"
                    creditable={creditable.map((i) => ({ value: i.id, label: `${i.invoice_number} · ${usd(i.amount)}` }))}
                    defaults={{
                      amount: Number(p.refund_amount) > 0 ? String(p.refund_amount) : "",
                      issueDate: today,
                      dueDate: addDays(today, 30),
                      description: `Credit for ${name} placement${p.falloff_reason ? ` — ${p.falloff_reason}` : ""}`,
                    }}
                  />
                </div>
              </details>
            )}
          </Panel>

          <Panel id="commissions" title="Commissions" description={`Splits total ${splitTotal}% of the fee (net of refunds).`}>
            {commissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commissions recorded.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {commissions.map((c) => (
                  <li key={c.id} className="grid gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{c.recruiter_name}</span> · {Number(c.split_percent)}% split × {Number(c.rate_percent)}% rate
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{usd(c.amount)}</span>
                        <Badge variant="outline" title={COMMISSION_STATUS[c.status]?.help}>
                          {COMMISSION_STATUS[c.status]?.label ?? c.status}
                        </Badge>
                      </span>
                    </div>
                    {c.paid_on && (
                      <p className="text-xs text-muted-foreground">
                        Paid {usd(c.paid_amount)} on {c.paid_on}
                      </p>
                    )}
                    <CommissionRowActions commissionId={c.id} placementId={p.id} amount={Number(c.amount)} paid={Boolean(c.paid_on)} />
                  </li>
                ))}
              </ul>
            )}
            {!closed && <CommissionForm placementId={p.id} staff={staff} />}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          {!closed && (
            <Panel id="status" title="Status">
              <PlacementStatusForm placementId={p.id} status={p.status} feeAmount={Number(p.fee_amount)} />
            </Panel>
          )}

          {p.status === "fell_off" && (
            <Panel id="falloff" title="Fall-off">
              <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="text-muted-foreground">Left on</dt>
                <dd>{p.fell_off_on}</dd>
                <dt className="text-muted-foreground">Reason</dt>
                <dd>{p.falloff_reason}</dd>
                <dt className="text-muted-foreground">Resolution</dt>
                <dd>{labelOf(RESOLUTIONS, p.resolution)}</dd>
              </dl>
              {p.resolution === "replacement" &&
                (p.replacement_placement_id ? (
                  <Link href={`/recruiter/finance/placements/${p.replacement_placement_id}`} className="text-sm text-brand hover:underline">
                    View the replacement placement
                  </Link>
                ) : (
                  <ReplacementForm
                    placementId={p.id}
                    options={otherPlacements.map((o) => ({ value: o.id, label: `${o.candidates ? fullName(o.candidates) : "Candidate"} · start ${o.start_date}` }))}
                  />
                ))}
            </Panel>
          )}

          {p.status === "cancelled" && p.falloff_reason && (
            <Panel id="cancelled" title="Cancelled">
              <p className="text-sm">{p.falloff_reason}</p>
            </Panel>
          )}

          {!closed && (
            <Panel id="terms" title="Terms">
              <PlacementTermsForm
                mode="update"
                id={p.id}
                terms={{
                  offerAcceptedOn: p.offer_accepted_on,
                  startDate: p.start_date,
                  baseSalary: String(p.base_salary),
                  feeType: p.fee_type,
                  feePercent: p.fee_percent != null ? String(p.fee_percent) : "",
                  feeFlat: p.fee_flat != null ? String(p.fee_flat) : "",
                  guaranteeDays: String(p.guarantee_days),
                  notes: p.notes ?? "",
                }}
              />
            </Panel>
          )}
        </div>
      </div>
    </Container>
  );
}
