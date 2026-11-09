"use client";

import { useActionState, useState } from "react";

import {
  createContractInvoice,
  reviewTimesheetAsStaff,
  saveAssignment,
  saveTimesheet,
  setAssignmentStatus,
  setPayrollStatus,
} from "@/app/recruiter/contracts/actions";
import { InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { assignmentWarnings, EMPLOYMENT_MODELS, hourlyEconomics, PAY_FREQUENCIES, type Warning } from "@/lib/contracts/validation";
import { usd } from "@/lib/finance/validation";
import { type FormState, initialFormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

function InlineStatus({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

export function WarningList({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {warnings.map((w) => (
        <li
          key={w.message}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            w.level === "danger" && "border-destructive/40 bg-destructive/5 text-destructive",
            w.level === "warning" && "border-amber-300 bg-amber-50 text-amber-950",
            w.level === "info" && "border-border bg-muted/40",
          )}
        >
          {w.message}
        </li>
      ))}
    </ul>
  );
}

const num = (s: string) => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export type AssignmentValues = {
  assignmentId: string;
  candidateId: string;
  companyId: string;
  title: string;
  employmentModel: string;
  startDate: string;
  endDate: string;
  billRate: string;
  payRate: string;
  otBillMultiplier: string;
  otPayMultiplier: string;
  burdenPercent: string;
  clientTermsDays: string;
  payFrequency: string;
  notes: string;
};

export function AssignmentForm({ values: initial, workers, clients, locked }: { values: AssignmentValues; workers: Option[]; clients: Option[]; locked?: boolean }) {
  const [state, action] = useActionState(saveAssignment, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: keyof AssignmentValues) => state.values?.[k] ?? initial[k];
  const [live, setLive] = useState({
    billRate: v("billRate"),
    payRate: v("payRate"),
    burdenPercent: v("burdenPercent"),
    clientTermsDays: v("clientTermsDays"),
    payFrequency: v("payFrequency"),
    employmentModel: v("employmentModel"),
  });
  const set = (k: keyof typeof live) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setLive((s) => ({ ...s, [k]: e.target.value }));
  const rates = { billRate: num(live.billRate), payRate: num(live.payRate), burdenPercent: num(live.burdenPercent) };
  const econ = hourlyEconomics(rates);
  const warnings =
    rates.billRate > 0 && rates.payRate > 0
      ? assignmentWarnings({ ...rates, clientTermsDays: num(live.clientTermsDays), payFrequency: live.payFrequency, employmentModel: live.employmentModel })
      : [];

  return (
    <form action={action} className="grid gap-5" noValidate>
      {initial.assignmentId && <input type="hidden" name="assignmentId" value={initial.assignmentId} />}
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField name="candidateId" label="Worker" required options={workers} defaultValue={v("candidateId")} error={errors.candidateId} />
        {locked ? (
          <>
            <input type="hidden" name="companyId" value={initial.companyId} />
            <InputField name="clientName" label="Client" value={clients.find((c) => c.value === initial.companyId)?.label ?? ""} readOnly disabled hint="The client can't change once timesheets exist." />
          </>
        ) : (
          <SelectField name="companyId" label="Client" required options={clients} defaultValue={v("companyId")} error={errors.companyId} />
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="title" label="Role title" required maxLength={200} defaultValue={v("title")} error={errors.title} />
        <SelectField
          name="employmentModel"
          label="How the worker is engaged"
          required
          options={EMPLOYMENT_MODELS}
          value={live.employmentModel}
          onChange={set("employmentModel")}
          error={errors.employmentModel}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="startDate" label="Start date" required type="date" defaultValue={v("startDate")} error={errors.startDate} />
        <InputField name="endDate" label="End date" type="date" defaultValue={v("endDate")} error={errors.endDate} />
      </div>
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-base font-semibold text-ink">Rates (USD per hour)</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <InputField name="billRate" label="Bill rate" required inputMode="decimal" value={live.billRate} onChange={set("billRate")} error={errors.billRate} />
          <InputField name="payRate" label="Pay rate" required inputMode="decimal" value={live.payRate} onChange={set("payRate")} error={errors.payRate} />
          <InputField name="otBillMultiplier" label="OT bill ×" required inputMode="decimal" defaultValue={v("otBillMultiplier")} error={errors.otBillMultiplier} />
          <InputField name="otPayMultiplier" label="OT pay ×" required inputMode="decimal" defaultValue={v("otPayMultiplier")} error={errors.otPayMultiplier} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <InputField
            name="burdenPercent"
            label="Estimated burden %"
            required
            inputMode="decimal"
            value={live.burdenPercent}
            onChange={set("burdenPercent")}
            hint="Employer taxes, workers' comp, benefits. An estimate — confirm with your payroll provider."
            error={errors.burdenPercent}
          />
          <InputField name="clientTermsDays" label="Client pays within (days)" required type="number" min={0} max={120} value={live.clientTermsDays} onChange={set("clientTermsDays")} error={errors.clientTermsDays} />
          <SelectField name="payFrequency" label="Worker paid" required options={PAY_FREQUENCIES} value={live.payFrequency} onChange={set("payFrequency")} />
        </div>
        {rates.billRate > 0 && rates.payRate > 0 && (
          <p className="text-sm">
            Per hour: spread <strong>{usd(econ.spread)}</strong> · est. burden {usd(econ.burden)} · net <strong>{usd(econ.net)}</strong> ({econ.netMarginPercent}% of billing, {econ.markupPercent}% markup)
          </p>
        )}
        <WarningList warnings={warnings} />
      </fieldset>
      <TextareaField name="notes" label="Notes (internal)" maxLength={2000} className="min-h-20" defaultValue={v("notes")} error={errors.notes} />
      <div>
        <SubmitButton pendingLabel="Saving…">{initial.assignmentId ? "Save assignment" : "Create assignment"}</SubmitButton>
      </div>
    </form>
  );
}

export function AssignmentStatusButtons({ assignmentId, status }: { assignmentId: string; status: string }) {
  const [state, action] = useActionState(setAssignmentStatus, initialFormState);
  const next = status === "pending" ? [["active", "Mark active"], ["cancelled", "Cancel assignment"]] : status === "active" ? [["ended", "End assignment"]] : [];
  if (next.length === 0) return null;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        {next.map(([value, label]) => (
          <form key={value} action={action}>
            <input type="hidden" name="assignmentId" value={assignmentId} />
            <input type="hidden" name="status" value={value} />
            <SubmitButton size="sm" variant={value === "active" ? "default" : "outline"}>
              {label}
            </SubmitButton>
          </form>
        ))}
      </div>
      <InlineStatus state={state} />
    </div>
  );
}

export function TimesheetForm({ assignmentId, weeks, preset }: { assignmentId: string; weeks: Option[]; preset?: { weekStart: string; regularHours: string; overtimeHours: string; notes: string } }) {
  const [state, action] = useActionState(saveTimesheet, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: "weekStart" | "regularHours" | "overtimeHours" | "notes", fallback: string) => state.values?.[k] ?? preset?.[k] ?? fallback;
  if (weeks.length === 0) return <p className="text-sm text-muted-foreground">No open weeks to enter.</p>;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField name="weekStart" label="Week starting (Monday)" required options={weeks} defaultValue={v("weekStart", weeks[0].value)} error={errors.weekStart} />
        <InputField name="regularHours" label="Regular hours" required inputMode="decimal" defaultValue={v("regularHours", "40")} error={errors.regularHours} />
        <InputField name="overtimeHours" label="Overtime hours" required inputMode="decimal" defaultValue={v("overtimeHours", "0")} error={errors.overtimeHours} />
      </div>
      <InputField name="notes" label="Notes (visible to the client)" maxLength={1000} defaultValue={v("notes", "")} error={errors.notes} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="submit" value="true" pendingLabel="Saving…">
          Save &amp; send for client approval
        </SubmitButton>
        <SubmitButton name="submit" value="false" variant="outline">
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}

export function StaffReviewForm({ assignmentId, timesheetId }: { assignmentId: string; timesheetId: string }) {
  const [state, action] = useActionState(reviewTimesheetAsStaff, initialFormState);
  const [open, setOpen] = useState(false);
  if (state.status === "success") return <InlineStatus state={state} />;
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Record client decision
      </Button>
    );
  }
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <input
        name="note"
        maxLength={1000}
        placeholder="e.g. Approved by J. Lee by email, Nov 8"
        aria-label="How the client decided"
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <div className="flex flex-wrap gap-1">
        <SubmitButton size="sm" name="approve" value="true">
          Approved
        </SubmitButton>
        <SubmitButton size="sm" variant="outline" name="approve" value="false">
          Send back
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <InlineStatus state={state} />
    </form>
  );
}

export function PayrollStatusForm({ assignmentId, timesheetId, status, reference }: { assignmentId: string; timesheetId: string; status: string; reference: string | null }) {
  const [state, action] = useActionState(setPayrollStatus, initialFormState);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <div className="flex flex-wrap items-center gap-1">
        <label className="sr-only" htmlFor={`payroll-${timesheetId}`}>
          Payroll status
        </label>
        <select
          id={`payroll-${timesheetId}`}
          name="status"
          defaultValue={status === "not_ready" ? "ready" : status}
          className="h-8 rounded-lg border border-input bg-background px-2 text-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <option value="ready">Ready for payroll</option>
          <option value="sent_to_provider">Sent to provider</option>
          <option value="paid_by_provider">Paid by provider</option>
        </select>
        <input
          name="reference"
          maxLength={200}
          defaultValue={reference ?? ""}
          placeholder="Provider ref."
          aria-label="Payroll provider reference"
          className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <SubmitButton size="sm" variant="ghost">
          Save
        </SubmitButton>
      </div>
      <InlineStatus state={state} />
    </form>
  );
}

export function ContractInvoiceForm({ assignmentId, weeks, today, due }: { assignmentId: string; weeks: { id: string; label: string; billing: number }[]; today: string; due: string }) {
  const [state, action] = useActionState(createContractInvoice, initialFormState);
  const [picked, setPicked] = useState<string[]>(weeks.map((w) => w.id));
  const total = weeks.filter((w) => picked.includes(w.id)).reduce((s, w) => s + w.billing, 0);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormMessage state={state} />
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Approved weeks not yet invoiced</legend>
        {weeks.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="timesheetIds"
              value={w.id}
              checked={picked.includes(w.id)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, w.id] : p.filter((x) => x !== w.id)))}
              className="size-4 accent-brand"
            />
            {w.label} · {usd(w.billing)}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField name="issueDate" label="Issue date" required type="date" defaultValue={today} />
        <InputField name="dueDate" label="Due date" required type="date" defaultValue={due} />
      </div>
      <p className="text-sm">
        Invoice total: <strong>{usd(total)}</strong>
      </p>
      <div>
        <SubmitButton variant="outline" disabled={picked.length === 0} pendingLabel="Creating…">
          Create draft invoice
        </SubmitButton>
      </div>
    </form>
  );
}
