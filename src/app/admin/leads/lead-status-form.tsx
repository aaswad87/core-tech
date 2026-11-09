"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/forms/submit-button";
import { initialFormState } from "@/lib/forms";
import { LEAD_STATUSES } from "@/lib/leads/labels";

import { updateLeadStatus } from "./actions";

export function LeadStatusForm({ leadId, status, label }: { leadId: string; status: string; label: string }) {
  const [state, action] = useActionState(updateLeadStatus, initialFormState);

  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex items-center gap-2">
        <label htmlFor={`status-${leadId}`} className="sr-only">
          Status for {label}
        </label>
        <select
          id={`status-${leadId}`}
          name="status"
          defaultValue={status}
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
      {state.status !== "idle" && (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
