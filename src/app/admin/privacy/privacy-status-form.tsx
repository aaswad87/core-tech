"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/forms/submit-button";
import { initialFormState } from "@/lib/forms";

import { resolvePrivacyRequest } from "./actions";

const OPTIONS = [
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
];

export function PrivacyStatusForm({ requestId, status, note }: { requestId: string; status: string; note: string }) {
  const [state, action] = useActionState(resolvePrivacyRequest, initialFormState);

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`privacy-status-${requestId}`} className="sr-only">
          Status
        </label>
        <select
          id={`privacy-status-${requestId}`}
          name="status"
          defaultValue={status === "open" ? "in_progress" : status}
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
      <label htmlFor={`privacy-note-${requestId}`} className="sr-only">
        Reply shown to the requester
      </label>
      <textarea
        id={`privacy-note-${requestId}`}
        name="note"
        maxLength={2000}
        defaultValue={note}
        placeholder="Reply shown to the requester (required when declining)"
        className="min-h-16 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      {state.status !== "idle" && (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
