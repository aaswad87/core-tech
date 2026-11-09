"use client";

import { PlusIcon } from "lucide-react";
import { useActionState } from "react";

import { addCandidateToJob, setJobStatus } from "@/app/recruiter/jobs/actions";
import { SelectField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { type FormState, initialFormState } from "@/lib/forms";

function Status({ state }: { state: FormState }) {
  const message = state.message ?? Object.values(state.fieldErrors ?? {})[0];
  if (state.status === "idle" || !message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {message}
    </p>
  );
}

/** Quick status buttons shown on the job page (e.g. Publish, Pause, Close). */
export function JobStatusButtons({ jobId, actions }: { jobId: string; actions: { status: string; label: string; primary?: boolean }[] }) {
  const [state, action] = useActionState(setJobStatus, initialFormState);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <form key={a.status} action={action}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="status" value={a.status} />
            <SubmitButton variant={a.primary ? "default" : "outline"} size="sm" className="rounded-full">
              {a.label}
            </SubmitButton>
          </form>
        ))}
      </div>
      <Status state={state} />
    </div>
  );
}

/** "Add to pipeline" for a known candidate and job (used in candidate search results on the job page). */
export function AddCandidateButton({ jobId, candidateId, label }: { jobId: string; candidateId: string; label: string }) {
  const [state, action] = useActionState(addCandidateToJob, initialFormState);
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="candidateId" value={candidateId} />
      {state.status === "success" ? (
        <span className="text-sm text-success">Added</span>
      ) : (
        <SubmitButton variant="outline" size="sm" pendingLabel="Adding…" aria-label={`Add ${label} to this job's pipeline`}>
          <PlusIcon aria-hidden="true" /> Add
        </SubmitButton>
      )}
      {state.status === "error" && <Status state={state} />}
    </form>
  );
}

/** Job picker on the candidate page. */
export function AddToJobForm({ candidateId, jobs }: { candidateId: string; jobs: { id: string; title: string; company: string | null }[] }) {
  const [state, action] = useActionState(addCandidateToJob, initialFormState);
  return (
    <form action={action} className="grid gap-2 rounded-lg border border-dashed border-border p-4" noValidate>
      <input type="hidden" name="candidateId" value={candidateId} />
      <SelectField
        name="jobId"
        label="Add to a job's pipeline"
        required
        options={jobs.map((j) => ({ value: j.id, label: j.company ? `${j.title} — ${j.company}` : j.title }))}
        placeholder={jobs.length ? "Choose a job…" : "No open jobs"}
        disabled={!jobs.length}
        defaultValue=""
      />
      <div className="flex items-center gap-3">
        <SubmitButton variant="outline" disabled={!jobs.length} pendingLabel="Adding…">
          Add to pipeline
        </SubmitButton>
        <Status state={state} />
      </div>
    </form>
  );
}
