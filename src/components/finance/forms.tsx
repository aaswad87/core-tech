"use client";

import { useActionState, useState } from "react";

import {
  changePlacementStatus,
  createInvoice,
  createPlacement,
  deletePayment,
  linkReplacement,
  markCommissionPaid,
  markInvoiceSent,
  recordPayment,
  removeCommission,
  setCommission,
  updatePlacementTerms,
  voidInvoice,
} from "@/app/recruiter/finance/actions";
import { InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { computeFee, PAYMENT_METHODS, RESOLUTIONS, usd } from "@/lib/finance/validation";
import { type FormState, initialFormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;
type Option = { value: string; label: string };

function InlineStatus({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

const toNumber = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : undefined;
};

// --- Placement terms --------------------------------------------------------

export type Terms = {
  offerAcceptedOn: string;
  startDate: string;
  baseSalary: string;
  feeType: string;
  feePercent: string;
  feeFlat: string;
  guaranteeDays: string;
  notes: string;
};

export function PlacementTermsForm({ mode, id, terms }: { mode: "create" | "update"; id: string; terms: Terms }) {
  const [state, action] = useActionState(mode === "create" ? createPlacement : updatePlacementTerms, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: keyof Terms) => state.values?.[k] ?? terms[k];
  const [feeType, setFeeType] = useState(v("feeType") || "percentage");
  const [salary, setSalary] = useState(v("baseSalary"));
  const [pct, setPct] = useState(v("feePercent"));
  const [flat, setFlat] = useState(v("feeFlat"));
  const preview = computeFee({ feeType, baseSalary: toNumber(salary), feePercent: toNumber(pct), feeFlat: toNumber(flat) });

  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name={mode === "create" ? "applicationId" : "placementId"} value={id} />
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="offerAcceptedOn" label="Offer accepted on" required type="date" defaultValue={v("offerAcceptedOn")} error={errors.offerAcceptedOn} />
        <InputField name="startDate" label="Start date" required type="date" defaultValue={v("startDate")} error={errors.startDate} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <InputField name="baseSalary" label="Base salary (USD/year)" required inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} error={errors.baseSalary} />
        <SelectField
          name="feeType"
          label="Fee"
          required
          options={[
            { value: "percentage", label: "Percentage of salary" },
            { value: "flat", label: "Flat amount" },
          ]}
          value={feeType}
          onChange={(e) => setFeeType(e.target.value)}
          error={errors.feeType}
        />
        {feeType === "percentage" ? (
          <InputField name="feePercent" label="Fee %" required inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} error={errors.feePercent} />
        ) : (
          <InputField name="feeFlat" label="Flat fee (USD)" required inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value)} error={errors.feeFlat} />
        )}
      </div>
      <p className="text-sm">
        Fee: <strong>{preview !== null ? usd(preview) : "—"}</strong>
      </p>
      <InputField
        name="guaranteeDays"
        label="Guarantee period (days)"
        required
        type="number"
        min={0}
        max={365}
        defaultValue={v("guaranteeDays") || "90"}
        hint="If the candidate leaves within this period, a replacement or refund is usually owed."
        error={errors.guaranteeDays}
      />
      <TextareaField name="notes" label="Notes (internal)" maxLength={2000} className="min-h-20" defaultValue={v("notes")} error={errors.notes} />
      <div>
        <SubmitButton pendingLabel="Saving…">{mode === "create" ? "Record placement" : "Save terms"}</SubmitButton>
      </div>
    </form>
  );
}

// --- Status -----------------------------------------------------------------

export function PlacementStatusForm({ placementId, status, feeAmount }: { placementId: string; status: string; feeAmount: number }) {
  const [state, action] = useActionState(changePlacementStatus, initialFormState);
  const errors = state.fieldErrors ?? {};
  const options: Option[] =
    status === "pending_start"
      ? [
          { value: "started", label: "Candidate started" },
          { value: "cancelled", label: "Cancelled before start" },
        ]
      : [{ value: "fell_off", label: "Candidate left (fall-off)" }];
  const [next, setNext] = useState(state.values?.status ?? options[0].value);
  const [resolution, setResolution] = useState(state.values?.resolution ?? "");

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="placementId" value={placementId} />
      <FormMessage state={state} />
      <SelectField name="status" label="New status" required options={options} value={next} onChange={(e) => setNext(e.target.value)} error={errors.status} />
      {next !== "started" && (
        <InputField name="reason" label="Reason" required maxLength={1000} defaultValue={state.values?.reason} error={errors.reason} />
      )}
      {next === "fell_off" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField name="fellOffOn" label="Date they left" required type="date" defaultValue={state.values?.fellOffOn} error={errors.fellOffOn} />
            <SelectField
              name="resolution"
              label="Resolution"
              required
              options={RESOLUTIONS}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              error={errors.resolution}
            />
          </div>
          {(resolution === "refund" || resolution === "partial_refund") && (
            <InputField
              name="refundAmount"
              label="Refund owed (USD)"
              required
              inputMode="decimal"
              defaultValue={state.values?.refundAmount ?? (resolution === "refund" ? String(feeAmount) : "")}
              hint={`The fee was ${usd(feeAmount)}.`}
              error={errors.refundAmount}
            />
          )}
        </>
      )}
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Update status
        </SubmitButton>
      </div>
    </form>
  );
}

export function ReplacementForm({ placementId, options }: { placementId: string; options: Option[] }) {
  const [state, action] = useActionState(linkReplacement, initialFormState);
  if (options.length === 0) return <p className="text-sm text-muted-foreground">Record the replacement candidate&apos;s placement first, then link it here.</p>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="placementId" value={placementId} />
      <div className="min-w-56 flex-1">
        <SelectField name="replacementId" label="Replacement placement" required options={options} />
      </div>
      <SubmitButton variant="outline" size="sm">
        Link
      </SubmitButton>
      <div className="w-full">
        <InlineStatus state={state} />
      </div>
    </form>
  );
}

// --- Commissions ------------------------------------------------------------

export function CommissionForm({ placementId, staff }: { placementId: string; staff: Option[] }) {
  const [state, action] = useActionState(setCommission, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="placementId" value={placementId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField name="recruiterId" label="Recruiter" required options={staff} defaultValue={state.values?.recruiterId} error={errors.recruiterId} />
        <InputField name="splitPercent" label="Split %" required inputMode="decimal" defaultValue={state.values?.splitPercent ?? "100"} hint="Share of the fee credited." error={errors.splitPercent} />
        <InputField name="ratePercent" label="Commission rate %" required inputMode="decimal" defaultValue={state.values?.ratePercent ?? "10"} error={errors.ratePercent} />
      </div>
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
          Save commission
        </SubmitButton>
      </div>
    </form>
  );
}

export function CommissionRowActions({ commissionId, placementId, amount, paid }: { commissionId: string; placementId: string; amount: number; paid: boolean }) {
  const [removeState, removeAction] = useActionState(removeCommission, initialFormState);
  const [payState, payAction] = useActionState(markCommissionPaid, initialFormState);
  const [paying, setPaying] = useState(false);
  if (paid) return null;
  return (
    <div className="grid gap-2">
      {!paying ? (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setPaying(true)}>
            Record payout
          </Button>
          <form action={removeAction}>
            <input type="hidden" name="commissionId" value={commissionId} />
            <input type="hidden" name="placementId" value={placementId} />
            <SubmitButton variant="ghost" size="sm">
              Remove
            </SubmitButton>
          </form>
        </div>
      ) : (
        <form action={payAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="commissionId" value={commissionId} />
          <input type="hidden" name="placementId" value={placementId} />
          <InputField name="paidOn" label="Paid on" required type="date" error={payState.fieldErrors?.paidOn} />
          <InputField name="amount" label="Amount" required inputMode="decimal" defaultValue={String(amount)} error={payState.fieldErrors?.amount} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setPaying(false)}>
            Cancel
          </Button>
          <SubmitButton size="sm">Save payout</SubmitButton>
        </form>
      )}
      <InlineStatus state={payState.status !== "idle" ? payState : removeState} />
    </div>
  );
}

// --- Invoices ---------------------------------------------------------------

export function InvoiceForm({
  placementId,
  kind,
  creditable = [],
  defaults,
}: {
  placementId: string;
  kind: "invoice" | "credit_note";
  creditable?: Option[];
  defaults: { amount: string; issueDate: string; dueDate: string; description: string };
}) {
  const [state, action] = useActionState(createInvoice, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: keyof typeof defaults) => state.values?.[k] ?? defaults[k];
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="kind" value={kind} />
      <FormMessage state={state} />
      {kind === "credit_note" && (
        <SelectField name="creditsInvoiceId" label="Invoice being credited" required options={creditable} defaultValue={state.values?.creditsInvoiceId} error={errors.creditsInvoiceId} />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <InputField name="amount" label="Amount (USD)" required inputMode="decimal" defaultValue={v("amount")} error={errors.amount} />
        <InputField name="issueDate" label="Issue date" required type="date" defaultValue={v("issueDate")} error={errors.issueDate} />
        <InputField name="dueDate" label="Due date" required type="date" defaultValue={v("dueDate")} error={errors.dueDate} />
      </div>
      <InputField name="description" label="Description" required maxLength={1000} defaultValue={v("description")} error={errors.description} />
      <div>
        <SubmitButton variant="outline" pendingLabel="Creating…">
          {kind === "invoice" ? "Create draft invoice" : "Create draft credit note"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function MarkSentButton({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState(markInvoiceSent, initialFormState);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div>
        <SubmitButton pendingLabel="Saving…">Mark as sent</SubmitButton>
      </div>
      <InlineStatus state={state} />
    </form>
  );
}

function ReasonForm({ action, hidden, label, confirmLabel }: { action: Action; hidden: Record<string, string>; label: string; confirmLabel: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [open, setOpen] = useState(false);
  if (state.status === "success") return <InlineStatus state={state} />;
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      <input
        name="reason"
        required
        maxLength={500}
        placeholder="Reason"
        aria-label="Reason"
        className="h-8 min-w-48 flex-1 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <SubmitButton variant="destructive" size="sm">
        {confirmLabel}
      </SubmitButton>
      <div className="w-full">
        <InlineStatus state={state} />
      </div>
    </form>
  );
}

export function VoidInvoiceForm({ invoiceId }: { invoiceId: string }) {
  return <ReasonForm action={voidInvoice} hidden={{ invoiceId }} label="Void invoice" confirmLabel="Void" />;
}

export function DeletePaymentForm({ paymentId, invoiceId }: { paymentId: string; invoiceId: string }) {
  return <ReasonForm action={deletePayment} hidden={{ paymentId, invoiceId }} label="Remove" confirmLabel="Remove payment" />;
}

export function PaymentForm({ invoiceId, balance, label }: { invoiceId: string; balance: number; label: string }) {
  const [state, action] = useActionState(recordPayment, initialFormState);
  const errors = state.fieldErrors ?? {};
  const done = state.status === "success";
  return (
    <form action={action} className="grid gap-4" noValidate key={done ? "done" : "form"}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <InputField name="amount" label="Amount (USD)" required inputMode="decimal" defaultValue={done ? "" : (state.values?.amount ?? String(balance))} error={errors.amount} />
        <InputField name="receivedOn" label={label} required type="date" defaultValue={done ? "" : state.values?.receivedOn} error={errors.receivedOn} />
        <SelectField name="method" label="Method" required options={PAYMENT_METHODS} defaultValue={done ? "ach" : (state.values?.method ?? "ach")} error={errors.method} />
      </div>
      <InputField name="reference" label="Reference" maxLength={200} placeholder="Check number, ACH trace…" defaultValue={done ? "" : state.values?.reference} error={errors.reference} />
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Record payment
        </SubmitButton>
      </div>
    </form>
  );
}
