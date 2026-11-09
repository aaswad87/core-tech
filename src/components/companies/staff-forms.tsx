"use client";

import { useActionState, useState } from "react";

import {
  addCompanyMember,
  convertJobRequest,
  createCompany,
  handleInterviewRequest,
  handleMemberRequest,
  removeCompanyMember,
  reviewJobRequest,
  shareResume,
} from "@/app/recruiter/companies/actions";
import { InputField, SelectField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { MEMBER_ROLES } from "@/lib/employer/validation";
import { type FormState, initialFormState } from "@/lib/forms";

const smallControl =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

function InlineStatus({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
      {state.message}
    </p>
  );
}

export function CreateCompanyForm() {
  const [state, action] = useActionState(createCompany, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <InputField name="name" label="Company name" required maxLength={200} defaultValue={state.values?.name} error={errors.name} />
        <InputField name="website" label="Website" type="url" placeholder="https://" defaultValue={state.values?.website} error={errors.website} />
        <InputField name="industry" label="Industry" maxLength={120} defaultValue={state.values?.industry} error={errors.industry} />
      </div>
      <div>
        <SubmitButton pendingLabel="Creating…">Add company</SubmitButton>
      </div>
    </form>
  );
}

export function AddMemberForm({ companyId, defaultEmail = "" }: { companyId: string; defaultEmail?: string }) {
  const [state, action] = useActionState(addCompanyMember, initialFormState);
  const errors = state.fieldErrors ?? {};
  const added = state.status === "success";
  return (
    <form action={action} className="grid gap-3" noValidate key={added ? "added" : "form"}>
      <input type="hidden" name="companyId" value={companyId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <InputField
          name="email"
          label="Account email"
          type="email"
          required
          defaultValue={added ? "" : (state.values?.email ?? defaultEmail)}
          hint="The person must already have an account with the Employer role."
          error={errors.email}
        />
        <SelectField name="memberRole" label="Role" required options={MEMBER_ROLES} defaultValue={state.values?.memberRole ?? "member"} />
      </div>
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Adding…">
          Give access
        </SubmitButton>
      </div>
    </form>
  );
}

export function RemoveMemberButton({ companyId, userId, name }: { companyId: string; userId: string; name: string }) {
  const [state, action] = useActionState(removeCompanyMember, initialFormState);
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        Remove<span className="sr-only"> {name}</span>
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="userId" value={userId} />
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
      <SubmitButton variant="destructive" size="sm" pendingLabel="Removing…">
        Confirm remove
      </SubmitButton>
      <InlineStatus state={state} />
    </form>
  );
}

export function MemberRequestButtons({ companyId, requestId }: { companyId: string; requestId: string }) {
  const [state, action] = useActionState(handleMemberRequest, initialFormState);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {(["completed", "dismissed"] as const).map((status) => (
          <form key={status} action={action}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="status" value={status} />
            <SubmitButton variant={status === "completed" ? "outline" : "ghost"} size="sm">
              {status === "completed" ? "Mark done" : "Dismiss"}
            </SubmitButton>
          </form>
        ))}
      </div>
      <InlineStatus state={state} />
    </div>
  );
}

export function JobRequestReview({ companyId, requestId, status }: { companyId: string; requestId: string; status: string }) {
  const [reviewState, reviewAction] = useActionState(reviewJobRequest, initialFormState);
  const [convertState, convertAction] = useActionState(convertJobRequest, initialFormState);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={convertAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <SubmitButton size="sm" pendingLabel="Creating job…">
            Create draft job
          </SubmitButton>
        </form>
        {status === "submitted" && (
          <form action={reviewAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="status" value="in_review" />
            <SubmitButton variant="outline" size="sm">
              Mark in review
            </SubmitButton>
          </form>
        )}
      </div>
      <form action={reviewAction} className="flex flex-wrap items-start gap-2">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="status" value="declined" />
        <label htmlFor={`decline-${requestId}`} className="sr-only">
          Reason shown to the employer
        </label>
        <input id={`decline-${requestId}`} name="note" maxLength={2000} placeholder="Reason shown to the employer" className={`${smallControl} min-w-56 flex-1`} />
        <SubmitButton variant="ghost" size="sm">
          Decline
        </SubmitButton>
      </form>
      <InlineStatus state={convertState.status === "error" ? convertState : reviewState} />
    </div>
  );
}

export function ShareResumeForm({
  companyId,
  submissionId,
  resumes,
  sharedResumeId,
}: {
  companyId: string;
  submissionId: string;
  resumes: { id: string; file_name: string }[];
  sharedResumeId: string | null;
}) {
  const [state, action] = useActionState(shareResume, initialFormState);
  if (resumes.length === 0) return <p className="text-xs text-muted-foreground">No resume on file for this candidate.</p>;
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`share-${submissionId}`} className="text-xs text-muted-foreground">
          Resume shared with employer
        </label>
        <select id={`share-${submissionId}`} name="resumeId" defaultValue={sharedResumeId ?? ""} className={smallControl}>
          <option value="">Not shared</option>
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.file_name}
            </option>
          ))}
        </select>
        <SubmitButton variant="outline" size="sm">
          Save
        </SubmitButton>
      </div>
      <InlineStatus state={state} />
    </form>
  );
}

/** Declines an employer interview request. Accepting one goes through Schedule interview, which creates the interview. */
export function DeclineInterviewRequestForm({ companyId, requestId }: { companyId: string; requestId: string }) {
  const [state, action] = useActionState(handleInterviewRequest, initialFormState);
  return (
    <div className="grid gap-1">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="status" value="declined" />
        <input name="note" maxLength={2000} placeholder="Reason shown to the employer" aria-label="Reason shown to the employer" className={`${smallControl} min-w-56 flex-1`} />
        <SubmitButton variant="ghost" size="sm">
          Decline
        </SubmitButton>
      </form>
      <InlineStatus state={state} />
    </div>
  );
}
