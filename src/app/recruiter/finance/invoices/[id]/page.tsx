import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeletePaymentForm, MarkSentButton, PaymentForm, VoidInvoiceForm } from "@/components/finance/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { idSchema } from "@/lib/candidates/validation";
import { getInvoice } from "@/lib/finance/queries";
import { INVOICE_STATUS, labelOf, PAYMENT_METHODS, usd } from "@/lib/finance/validation";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/recruiter/finance/invoices/[id]">) {
  const { id } = await params;
  await requireRole(["admin"], `/recruiter/finance/invoices/${id}`);
  if (!idSchema.safeParse(id).success) notFound();
  const data = await getInvoice(id);
  if (!data) notFound();

  const { invoice: inv, payments, credits, original } = data;
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Number(inv.amount) - paid;
  const isCredit = inv.kind === "credit_note";
  const open = inv.status === "sent" || inv.status === "partially_paid";
  const pl = inv.placements;

  return (
    <Container className="grid max-w-4xl gap-6 py-10">
      <div className="print:hidden">
        <Link
          href={inv.assignment_id ? `/recruiter/contracts/${inv.assignment_id}` : inv.placement_id ? `/recruiter/finance/placements/${inv.placement_id}` : "/recruiter/finance"}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {inv.assignment_id ? "Assignment" : "Placement"}
        </Link>
      </div>

      {inv.status === "draft" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 print:hidden">
          Draft. Check the details, send it to the client (print or save as PDF from your browser), then mark it as sent.
        </p>
      )}

      {/* The document itself: prints cleanly from the browser. */}
      <article className="rounded-xl border border-border bg-background p-6 sm:p-10 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">CoreTech Recruiting</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">
              {isCredit ? "Credit note" : "Invoice"} {inv.invoice_number}
            </h1>
            {original && (
              <p className="text-sm text-muted-foreground">
                Credits{" "}
                <Link href={`/recruiter/finance/invoices/${original.id}`} className="text-brand hover:underline">
                  {original.invoice_number}
                </Link>
              </p>
            )}
          </div>
          <Badge variant="outline" className="print:hidden">
            {labelOf(INVOICE_STATUS, inv.status)}
          </Badge>
        </div>

        <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Bill to</p>
            <p className="font-medium">{inv.companies?.name}</p>
            {inv.companies?.headquarters && <p>{inv.companies.headquarters}</p>}
          </div>
          <dl className="grid grid-cols-[7rem_1fr] gap-1 sm:justify-self-end">
            <dt className="text-muted-foreground">Issued</dt>
            <dd>{inv.issue_date}</dd>
            <dt className="text-muted-foreground">Due</dt>
            <dd>{inv.due_date}</dd>
          </dl>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-3 pr-4">
                {inv.description}
                {inv.timesheets.length > 0 && (
                  <ul className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
                    {[...inv.timesheets]
                      .sort((x, y) => x.week_start.localeCompare(y.week_start))
                      .map((t) => (
                        <li key={t.id}>
                          Week of {t.week_start}: {Number(t.regular_hours)} h × {usd(t.bill_rate)}
                          {Number(t.overtime_hours) > 0 && ` + ${Number(t.overtime_hours)} h OT × ${usd(Number(t.bill_rate) * Number(t.ot_bill_multiplier))}`} = {usd(t.billing)}
                        </li>
                      ))}
                  </ul>
                )}
                {pl && !isCredit && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pl.candidates ? fullName(pl.candidates) : "Candidate"} · {pl.jobs?.title} · start {pl.start_date}
                    {pl.fee_type === "percentage" && pl.fee_percent != null && ` · ${Number(pl.fee_percent)}% of ${usd(pl.base_salary)}`}
                  </p>
                )}
              </td>
              <td className="py-3 text-right tabular-nums">
                {isCredit && "−"}
                {usd(inv.amount)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 text-right text-muted-foreground">{isCredit ? "Refunded" : "Paid"}</td>
              <td className="pt-3 text-right tabular-nums">{usd(paid)}</td>
            </tr>
            <tr>
              <td className="pt-1 text-right font-medium">{isCredit ? "Still to refund" : "Balance due"}</td>
              <td className="pt-1 text-right font-semibold tabular-nums">{inv.status === "void" ? usd(0) : usd(balance)}</td>
            </tr>
          </tfoot>
        </table>
        {inv.status === "void" && <p className="mt-6 text-sm font-medium text-destructive">Void: {inv.void_reason}</p>}
      </article>

      <div className="grid gap-6 print:hidden">
        {inv.status === "draft" && (
          <div className="flex flex-wrap items-start gap-4">
            <MarkSentButton invoiceId={inv.id} />
            <VoidInvoiceForm invoiceId={inv.id} />
          </div>
        )}
        {open && payments.length === 0 && <VoidInvoiceForm invoiceId={inv.id} />}

        <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-ink">{isCredit ? "Refunds paid" : "Payments received"}</h2>
          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="tabular-nums">{usd(p.amount)}</span> · {p.received_on} · {labelOf(PAYMENT_METHODS, p.method)}
                    {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  </span>
                  <DeletePaymentForm paymentId={p.id} invoiceId={inv.id} />
                </li>
              ))}
            </ul>
          )}
          {open && balance > 0 && (
            <div className="mt-4">
              <PaymentForm invoiceId={inv.id} balance={balance} label={isCredit ? "Refund paid on" : "Received on"} />
            </div>
          )}
        </section>

        {credits.length > 0 && (
          <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-ink">Credit notes against this invoice</h2>
            <ul className="mt-3 grid gap-1 text-sm">
              {credits.map((c) => (
                <li key={c.id}>
                  <Link href={`/recruiter/finance/invoices/${c.id}`} className="text-brand hover:underline">
                    {c.invoice_number}
                  </Link>{" "}
                  · {usd(c.amount)} · {labelOf(INVOICE_STATUS, c.status)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Container>
  );
}
