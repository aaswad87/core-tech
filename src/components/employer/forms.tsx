"use client";

import { useActionState, useState } from "react";

import {
  addFeedback,
  addInterviewFeedback,
  cancelInterview,
  cancelJobRequest,
  changeMemberRole,
  removeTeammate,
  requestInterview,
  requestTeammate,
  respondToSubmission,
  reviewTimesheet,
  submitJobRequest,
  updateCompanyProfile,
} from "@/app/employer/actions";
import { InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { INTERVIEW_DURATIONS, INTERVIEW_FORMATS, MEMBER_ROLES, US_TIMEZONES } from "@/lib/employer/validation";
import { type FormState, initialFormState } from "@/lib/forms";
import { RECOMMENDATIONS } from "@/lib/interviews/validation";
import { EMPLOYMENT_TYPES, WORK_ARRANGEMENT_OPTIONS } from "@/lib/jobs/validation";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function InlineStatus({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

// --- Company ----------------------------------------------------------------

export function CompanyProfileForm({
  companyId,
  company,
}: {
  companyId: string;
  company: { website: string; industry: string; headquarters: string; about: string };
}) {
  const [state, action] = useActionState(updateCompanyProfile, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: keyof typeof company) => state.values?.[k] ?? company[k];
  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="companyId" value={companyId} />
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="website" label="Website" type="url" placeholder="https://" maxLength={300} defaultValue={v("website")} error={errors.website} />
        <InputField name="industry" label="Industry" maxLength={120} placeholder="Telecommunications" defaultValue={v("industry")} error={errors.industry} />
      </div>
      <InputField name="headquarters" label="Headquarters" maxLength={200} placeholder="Dallas, TX" defaultValue={v("headquarters")} error={errors.headquarters} />
      <TextareaField
        name="about"
        label="About the company"
        maxLength={2000}
        hint="Recruiters use this when describing your company to candidates."
        defaultValue={v("about")}
        error={errors.about}
      />
      <div>
        <SubmitButton pendingLabel="Saving…">Save company profile</SubmitButton>
      </div>
    </form>
  );
}

export function TeammateRequestForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState(requestTeammate, initialFormState);
  const errors = state.fieldErrors ?? {};
  const sent = state.status === "success";
  return (
    <form action={action} className="grid gap-4" noValidate key={sent ? "sent" : "form"}>
      <input type="hidden" name="companyId" value={companyId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField name="fullName" label="Name" required maxLength={200} defaultValue={sent ? "" : state.values?.fullName} error={errors.fullName} />
        <InputField name="email" label="Work email" type="email" required maxLength={254} defaultValue={sent ? "" : state.values?.email} error={errors.email} />
      </div>
      <SelectField
        name="memberRole"
        label="Role"
        required
        options={MEMBER_ROLES}
        defaultValue={sent ? "member" : (state.values?.memberRole ?? "member")}
        hint="Owners can edit the company profile and manage the team."
        error={errors.memberRole}
      />
      <div>
        <SubmitButton variant="outline" pendingLabel="Sending…">
          Ask CoreTech to add them
        </SubmitButton>
      </div>
    </form>
  );
}

export function MemberControls({
  companyId,
  userId,
  memberRole,
  name,
}: {
  companyId: string;
  userId: string;
  memberRole: "owner" | "member";
  name: string;
}) {
  const [roleState, roleAction] = useActionState(changeMemberRole, initialFormState);
  const [removeState, removeAction] = useActionState(removeTeammate, initialFormState);
  const [armed, setArmed] = useState(false);
  const other = memberRole === "owner" ? "member" : "owner";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <form action={roleAction}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="memberRole" value={other} />
          <SubmitButton variant="ghost" size="sm" pendingLabel="Saving…">
            Make {other}
            <span className="sr-only"> ({name})</span>
          </SubmitButton>
        </form>
        {!armed ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
            Remove<span className="sr-only"> {name}</span>
          </Button>
        ) : (
          <form action={removeAction} className="flex items-center gap-1">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="userId" value={userId} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
              Cancel
            </Button>
            <SubmitButton variant="destructive" size="sm" pendingLabel="Removing…">
              Confirm remove
            </SubmitButton>
          </form>
        )}
      </div>
      <InlineStatus state={roleState.status === "error" ? roleState : removeState} />
    </div>
  );
}

// --- Job requests -----------------------------------------------------------

export function JobRequestForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState(submitJobRequest, initialFormState);
  const errors = state.fieldErrors ?? {};
  const sent = state.status === "success";
  const v = (k: string, fallback = "") => (sent ? fallback : (state.values?.[k] ?? fallback));

  return (
    <form action={action} className="grid gap-5" noValidate key={sent ? "sent" : "form"}>
      <input type="hidden" name="companyId" value={companyId} />
      <FormMessage state={state} />
      <InputField name="title" label="Job title" required maxLength={200} placeholder="Senior Network Engineer" defaultValue={v("title")} error={errors.title} />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField name="employmentType" label="Employment type" required options={EMPLOYMENT_TYPES} defaultValue={v("employmentType", "direct_hire")} error={errors.employmentType} />
        <SelectField name="workArrangement" label="Work arrangement" options={WORK_ARRANGEMENT_OPTIONS} placeholder="Not decided" defaultValue={v("workArrangement")} error={errors.workArrangement} />
        <InputField name="openings" label="Openings" required type="number" min={1} max={100} defaultValue={v("openings", "1")} error={errors.openings} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="location" label="Location" maxLength={200} placeholder="Dallas, TX" defaultValue={v("location")} error={errors.location} />
        <InputField name="targetStart" label="Target start date" type="date" defaultValue={v("targetStart")} error={errors.targetStart} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="salaryMin" label="Salary from (USD/year)" inputMode="numeric" placeholder="90,000" defaultValue={v("salaryMin")} error={errors.salaryMin} />
        <InputField name="salaryMax" label="Salary to (USD/year)" inputMode="numeric" placeholder="120,000" defaultValue={v("salaryMax")} error={errors.salaryMax} />
      </div>
      <TextareaField
        name="description"
        label="About the role"
        required
        maxLength={10000}
        hint="Responsibilities, team, and anything a candidate should know."
        defaultValue={v("description")}
        error={errors.description}
      />
      <InputField name="mustHaveSkills" label="Must-have skills" maxLength={1000} placeholder="BGP, OSPF, Palo Alto, CCNP" defaultValue={v("mustHaveSkills")} error={errors.mustHaveSkills} />
      <div>
        <SubmitButton pendingLabel="Sending…">Send job request</SubmitButton>
      </div>
    </form>
  );
}

function ConfirmActionButton({
  action,
  hidden,
  label,
  confirmLabel,
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  confirmLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [armed, setArmed] = useState(false);
  if (state.status === "success") return <InlineStatus state={state} />;
  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-1">
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Keep
      </Button>
      <SubmitButton variant="destructive" size="sm" pendingLabel="Working…">
        {confirmLabel}
      </SubmitButton>
      <InlineStatus state={state} />
    </form>
  );
}

export function CancelJobRequestButton({ companyId, requestId }: { companyId: string; requestId: string }) {
  return <ConfirmActionButton action={cancelJobRequest} hidden={{ companyId, requestId }} label="Cancel request" confirmLabel="Confirm cancel" />;
}

export function CancelInterviewButton({ companyId, requestId }: { companyId: string; requestId: string }) {
  return <ConfirmActionButton action={cancelInterview} hidden={{ companyId, requestId }} label="Cancel interview" confirmLabel="Confirm cancel" />;
}

// --- Submissions ------------------------------------------------------------

export function SubmissionResponse({ companyId, submissionId, status }: { companyId: string; submissionId: string; status: string }) {
  const [state, action] = useActionState(respondToSubmission, initialFormState);
  const [declining, setDeclining] = useState(false);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "submitted" && (
          <form action={action}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="submissionId" value={submissionId} />
            <input type="hidden" name="status" value="under_review" />
            <SubmitButton variant="outline" pendingLabel="Saving…">
              Mark under review
            </SubmitButton>
          </form>
        )}
        {!declining ? (
          <Button type="button" variant="ghost" onClick={() => setDeclining(true)}>
            Not moving forward
          </Button>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="submissionId" value={submissionId} />
            <input type="hidden" name="status" value="declined" />
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>
              Keep
            </Button>
            <SubmitButton variant="destructive" pendingLabel="Saving…">
              Confirm not moving forward
            </SubmitButton>
          </form>
        )}
      </div>
      <InlineStatus state={state} />
    </div>
  );
}

export function FeedbackForm({ companyId, submissionId }: { companyId: string; submissionId: string }) {
  const [state, action] = useActionState(addFeedback, initialFormState);
  const errors = state.fieldErrors ?? {};
  const sent = state.status === "success";
  return (
    <form action={action} className="grid gap-4" noValidate key={sent ? "sent" : "form"}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <FormMessage state={state} />
      <SelectField
        name="rating"
        label="Overall fit"
        options={[
          { value: "5", label: "5 — Excellent" },
          { value: "4", label: "4 — Strong" },
          { value: "3", label: "3 — Mixed" },
          { value: "2", label: "2 — Weak" },
          { value: "1", label: "1 — Not a fit" },
        ]}
        placeholder="No rating"
        defaultValue={sent ? "" : state.values?.rating}
        error={errors.rating}
      />
      <TextareaField
        name="body"
        label="Feedback for CoreTech"
        required
        maxLength={5000}
        className="min-h-24"
        hint="Job-related observations only. CoreTech uses this to refine the search; the candidate doesn't see it."
        defaultValue={sent ? "" : state.values?.body}
        error={errors.body}
      />
      <div>
        <SubmitButton variant="outline" pendingLabel="Sending…">
          Share feedback
        </SubmitButton>
      </div>
    </form>
  );
}

export function TimesheetReview({ companyId, timesheetId, label }: { companyId: string; timesheetId: string; label: string }) {
  const [state, action] = useActionState(reviewTimesheet, initialFormState);
  const [rejecting, setRejecting] = useState(false);
  if (state.status === "success") return <InlineStatus state={state} />;
  return (
    <div className="grid gap-2">
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="timesheetId" value={timesheetId} />
            <input type="hidden" name="approve" value="true" />
            <SubmitButton size="sm" pendingLabel="Approving…">
              Approve<span className="sr-only"> {label}</span>
            </SubmitButton>
          </form>
          <Button type="button" variant="outline" size="sm" onClick={() => setRejecting(true)}>
            Send back
          </Button>
        </div>
      ) : (
        <form action={action} className="grid gap-2">
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <input type="hidden" name="approve" value="false" />
          <input
            name="note"
            required
            maxLength={1000}
            placeholder="What needs to change?"
            aria-label={`What needs to change for ${label}`}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <SubmitButton variant="destructive" size="sm">
              Send back
            </SubmitButton>
          </div>
        </form>
      )}
      <InlineStatus state={state} />
    </div>
  );
}

export function InterviewFeedbackForm({ companyId, interviewId }: { companyId: string; interviewId: string }) {
  const [state, action] = useActionState(addInterviewFeedback, initialFormState);
  const errors = state.fieldErrors ?? {};
  const sent = state.status === "success";
  return (
    <form action={action} className="grid gap-3" noValidate key={sent ? "sent" : "form"}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="interviewId" value={interviewId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="rating"
          label="Rating"
          options={["5", "4", "3", "2", "1"].map((r) => ({ value: r, label: `${r} / 5` }))}
          placeholder="No rating"
          defaultValue={sent ? "" : state.values?.rating}
        />
        <SelectField name="recommendation" label="Recommendation" options={RECOMMENDATIONS} placeholder="None" defaultValue={sent ? "" : state.values?.recommendation} />
      </div>
      <TextareaField
        name="body"
        label="How did the interview go?"
        required
        maxLength={5000}
        className="min-h-20"
        hint="Job-related observations only. The candidate doesn't see this."
        defaultValue={sent ? "" : state.values?.body}
        error={errors.body}
      />
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Sending…">
          Share interview feedback
        </SubmitButton>
      </div>
    </form>
  );
}

export function InterviewRequestForm({ companyId, submissionId }: { companyId: string; submissionId: string }) {
  const [state, action] = useActionState(requestInterview, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: string, fallback = "") => state.values?.[k] ?? fallback;
  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField name="format" label="Format" required options={INTERVIEW_FORMATS} defaultValue={v("format", "video")} error={errors.format} />
        <SelectField name="durationMinutes" label="Length" required options={INTERVIEW_DURATIONS} defaultValue={v("durationMinutes", "60")} error={errors.durationMinutes} />
        <SelectField name="timezone" label="Time zone" required options={US_TIMEZONES} defaultValue={v("timezone", "America/Chicago")} error={errors.timezone} />
      </div>
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">Times that work for you (up to 3)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <InputField name="slot1" label="First choice" required type="datetime-local" defaultValue={v("slot1")} error={errors.slot1} />
          <InputField name="slot2" label="Second choice" type="datetime-local" defaultValue={v("slot2")} error={errors.slot2} />
          <InputField name="slot3" label="Third choice" type="datetime-local" defaultValue={v("slot3")} error={errors.slot3} />
        </div>
      </fieldset>
      <InputField name="interviewers" label="Interviewers" maxLength={500} placeholder="Jordan Lee (Hiring manager)" defaultValue={v("interviewers")} error={errors.interviewers} />
      <TextareaField name="notes" label="Notes for CoreTech" maxLength={2000} className="min-h-20" defaultValue={v("notes")} error={errors.notes} />
      <div>
        <SubmitButton pendingLabel="Sending…">Request interview</SubmitButton>
      </div>
    </form>
  );
}
