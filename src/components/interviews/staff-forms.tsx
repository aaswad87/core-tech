"use client";

import { useActionState, useState } from "react";

import { addStaffInterviewFeedback, cancelInterview, recordOutcome, rescheduleInterview, scheduleInterview } from "@/app/recruiter/interviews/actions";
import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { INTERVIEW_DURATIONS, INTERVIEW_FORMATS, US_TIMEZONES } from "@/lib/employer/validation";
import { initialFormState } from "@/lib/forms";
import { INTERVIEW_OUTCOMES, RECOMMENDATIONS } from "@/lib/interviews/validation";

function NotifyBox({ emailReady, defaultChecked = true, children }: { emailReady: boolean; defaultChecked?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <CheckboxField name="notifyCandidate" defaultChecked={defaultChecked}>
        {children}
      </CheckboxField>
      {!emailReady && (
        <p className="text-xs text-amber-700">Email isn&apos;t set up yet, so nothing will be sent. The attempt is still logged; tell the candidate yourself.</p>
      )}
    </div>
  );
}

export type ScheduleDefaults = {
  applicationId: string;
  interviewRequestId?: string;
  kind?: string;
  format?: string;
  startsAtLocal?: string;
  durationMinutes?: string;
  timezone?: string;
  interviewers?: string;
  instructions?: string;
};

export function ScheduleInterviewForm({
  defaults,
  kinds,
  emailReady,
  proposedTimes = [],
}: {
  defaults: ScheduleDefaults;
  kinds: readonly { value: string; label: string }[];
  emailReady: boolean;
  /** Employer-proposed times as datetime-local values, offered as quick picks. */
  proposedTimes?: { value: string; label: string }[];
}) {
  const [state, action] = useActionState(scheduleInterview, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: keyof ScheduleDefaults | "meetingUrl" | "location", fallback = "") => state.values?.[k] ?? (defaults as Record<string, string | undefined>)[k] ?? fallback;
  const [format, setFormat] = useState(v("format", "video"));
  const [startsAt, setStartsAt] = useState(v("startsAtLocal"));

  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="applicationId" value={defaults.applicationId} />
      {defaults.interviewRequestId && <input type="hidden" name="interviewRequestId" value={defaults.interviewRequestId} />}
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField name="kind" label="Interview type" required options={kinds} defaultValue={v("kind", kinds[0]?.value)} error={errors.kind} />
        <SelectField
          name="format"
          label="Format"
          required
          options={INTERVIEW_FORMATS}
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          error={errors.format}
        />
      </div>
      {proposedTimes.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Times the employer proposed</p>
          <div className="flex flex-wrap gap-2">
            {proposedTimes.map((t) => (
              <Button key={t.value} type="button" size="sm" variant={startsAt === t.value ? "default" : "outline"} onClick={() => setStartsAt(t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-3">
        <InputField
          name="startsAtLocal"
          label="Date and time"
          required
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          error={errors.startsAtLocal}
        />
        <SelectField name="durationMinutes" label="Length" required options={INTERVIEW_DURATIONS} defaultValue={v("durationMinutes", "60")} error={errors.durationMinutes} />
        <SelectField name="timezone" label="Time zone" required options={US_TIMEZONES} defaultValue={v("timezone", "America/Chicago")} error={errors.timezone} />
      </div>
      {format === "video" && (
        <InputField name="meetingUrl" label="Meeting link" required type="url" placeholder="https://" maxLength={500} defaultValue={v("meetingUrl")} error={errors.meetingUrl} />
      )}
      {format === "onsite" && (
        <InputField name="location" label="Address" required maxLength={300} defaultValue={v("location")} error={errors.location} />
      )}
      <InputField name="interviewers" label="Interviewers" maxLength={500} placeholder="Jordan Lee (Hiring manager)" defaultValue={v("interviewers")} error={errors.interviewers} />
      <TextareaField
        name="instructions"
        label="Instructions for the candidate"
        maxLength={2000}
        className="min-h-20"
        hint="Shown to the candidate (and the employer for client interviews). Don't include internal notes."
        defaultValue={v("instructions")}
        error={errors.instructions}
      />
      <NotifyBox emailReady={emailReady}>Email the candidate a confirmation with a calendar invite</NotifyBox>
      <div>
        <SubmitButton pendingLabel="Scheduling…">Schedule interview</SubmitButton>
      </div>
    </form>
  );
}

export function RescheduleForm({
  interview,
  emailReady,
}: {
  interview: { id: string; format: string; startsAtLocal: string; durationMinutes: number; timezone: string; meetingUrl: string | null; location: string | null };
  emailReady: boolean;
}) {
  const [state, action] = useActionState(rescheduleInterview, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (k: string, fallback: string) => state.values?.[k] ?? fallback;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="interviewId" value={interview.id} />
      <input type="hidden" name="format" value={interview.format} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <InputField name="startsAtLocal" label="New date and time" required type="datetime-local" defaultValue={v("startsAtLocal", interview.startsAtLocal)} error={errors.startsAtLocal} />
        <SelectField name="durationMinutes" label="Length" required options={INTERVIEW_DURATIONS} defaultValue={v("durationMinutes", String(interview.durationMinutes))} />
        <SelectField name="timezone" label="Time zone" required options={US_TIMEZONES} defaultValue={v("timezone", interview.timezone)} error={errors.timezone} />
      </div>
      {interview.format === "video" && (
        <InputField name="meetingUrl" label="Meeting link" required type="url" defaultValue={v("meetingUrl", interview.meetingUrl ?? "")} error={errors.meetingUrl} />
      )}
      {interview.format === "onsite" && (
        <InputField name="location" label="Address" required defaultValue={v("location", interview.location ?? "")} error={errors.location} />
      )}
      <InputField name="reason" label="Reason (internal)" required maxLength={1000} defaultValue={v("reason", "")} error={errors.reason} />
      <NotifyBox emailReady={emailReady}>Email the candidate the new time with an updated calendar invite</NotifyBox>
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Reschedule
        </SubmitButton>
      </div>
    </form>
  );
}

export function CancelInterviewForm({ interviewId, emailReady }: { interviewId: string; emailReady: boolean }) {
  const [state, action] = useActionState(cancelInterview, initialFormState);
  const [open, setOpen] = useState(false);
  if (!open && state.status !== "error") {
    return (
      <div className="grid gap-2">
        {state.status === "success" && <FormMessage state={state} />}
        {state.status !== "success" && (
          <div>
            <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
              Cancel this interview
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="interviewId" value={interviewId} />
      <FormMessage state={state} />
      <InputField
        name="reason"
        label="Reason"
        required
        maxLength={1000}
        hint="Included in the candidate's cancellation email."
        defaultValue={state.values?.reason}
        error={state.fieldErrors?.reason}
      />
      <NotifyBox emailReady={emailReady}>Email the candidate that it&apos;s cancelled</NotifyBox>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
        <SubmitButton variant="destructive" pendingLabel="Cancelling…">
          Cancel interview
        </SubmitButton>
      </div>
    </form>
  );
}

export function OutcomeForm({ interviewId, status, outcome, summary }: { interviewId: string; status: string; outcome: string | null; summary: string | null }) {
  const [state, action] = useActionState(recordOutcome, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="interviewId" value={interviewId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="status"
          label="What happened"
          required
          options={[
            { value: "completed", label: "Completed" },
            { value: "no_show", label: "Candidate didn't attend" },
          ]}
          defaultValue={state.values?.status ?? (status === "no_show" ? "no_show" : "completed")}
          error={errors.status}
        />
        <SelectField name="outcome" label="Recruiter's assessment" options={INTERVIEW_OUTCOMES} placeholder="Not decided" defaultValue={state.values?.outcome ?? outcome ?? ""} error={errors.outcome} />
      </div>
      <TextareaField
        name="summary"
        label="Summary (internal)"
        maxLength={2000}
        className="min-h-20"
        hint="Job-related observations only. Never shown to the candidate or employer."
        defaultValue={state.values?.summary ?? summary ?? ""}
        error={errors.summary}
      />
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Save outcome
        </SubmitButton>
      </div>
    </form>
  );
}

export function StaffInterviewFeedbackForm({ interviewId }: { interviewId: string }) {
  const [state, action] = useActionState(addStaffInterviewFeedback, initialFormState);
  const errors = state.fieldErrors ?? {};
  const sent = state.status === "success";
  return (
    <form action={action} className="grid gap-4" noValidate key={sent ? "sent" : "form"}>
      <input type="hidden" name="interviewId" value={interviewId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="rating"
          label="Rating"
          options={["5", "4", "3", "2", "1"].map((r) => ({ value: r, label: `${r} / 5` }))}
          placeholder="No rating"
          defaultValue={sent ? "" : state.values?.rating}
        />
        <SelectField name="recommendation" label="Recommendation" options={RECOMMENDATIONS} placeholder="None" defaultValue={sent ? "" : state.values?.recommendation} />
      </div>
      <TextareaField name="body" label="Feedback" required maxLength={5000} className="min-h-20" defaultValue={sent ? "" : state.values?.body} error={errors.body} />
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Add feedback
        </SubmitButton>
      </div>
    </form>
  );
}
