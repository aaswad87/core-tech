"use client";

import { Trash2Icon, UploadIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { deleteMyResume, savePreferences, submitPrivacyRequest, updateMyProfile, uploadMyResume } from "@/app/candidate/actions";
import { CheckboxField, FieldShell, InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { PRIVACY_REQUEST_KINDS, WORK_ARRANGEMENTS } from "@/lib/candidates/portal";
import { initialFormState } from "@/lib/forms";

// --- Profile ----------------------------------------------------------------

export type MyProfile = {
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
};

export function ProfileForm({ profile, email }: { profile: MyProfile; email: string }) {
  const [state, action] = useActionState(updateMyProfile, initialFormState);
  const errors = state.fieldErrors ?? {};
  const value = (key: keyof MyProfile) => state.values?.[key] ?? profile[key];

  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="firstName" label="First name" required autoComplete="given-name" maxLength={100} defaultValue={value("firstName")} error={errors.firstName} />
        <InputField name="lastName" label="Last name" required autoComplete="family-name" maxLength={100} defaultValue={value("lastName")} error={errors.lastName} />
      </div>
      <InputField name="email" label="Email" required value={email} readOnly disabled hint="Your sign-in email. Contact us if it needs to change." />
      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="phone" label="Phone" type="tel" autoComplete="tel" maxLength={40} defaultValue={value("phone")} error={errors.phone} />
        <InputField name="location" label="Location" autoComplete="address-level2" maxLength={200} placeholder="Dallas, TX" defaultValue={value("location")} error={errors.location} />
      </div>
      <InputField
        name="headline"
        label="Headline"
        maxLength={200}
        placeholder="Senior Network Engineer · CCNP · SD-WAN"
        defaultValue={value("headline")}
        error={errors.headline}
      />
      <TextareaField
        name="summary"
        label="Summary"
        maxLength={5000}
        hint="A few sentences about your experience and the work you're looking for."
        defaultValue={value("summary")}
        error={errors.summary}
      />
      <div>
        <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
      </div>
    </form>
  );
}

// --- Resumes ----------------------------------------------------------------

export function ResumeUploadForm({ disabled }: { disabled?: boolean }) {
  const [state, action] = useActionState(uploadMyResume, initialFormState);
  return (
    <form action={action} encType="multipart/form-data" className="grid gap-3" noValidate>
      <FieldShell
        name="resume"
        label="Upload a resume"
        required
        hint={disabled ? "You have 5 resumes on file. Remove one to upload another." : "PDF or Word (.docx), up to 4 MB."}
        error={state.fieldErrors?.resume}
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            name="resume"
            type="file"
            required
            disabled={disabled}
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-describedby={describedBy}
            aria-invalid={state.fieldErrors?.resume ? true : undefined}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted disabled:opacity-50"
          />
        )}
      </FieldShell>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline" pendingLabel="Uploading…" disabled={disabled}>
          <UploadIcon aria-hidden="true" /> Upload
        </SubmitButton>
        {state.status !== "idle" && !state.fieldErrors && <FormMessage state={state} />}
      </div>
    </form>
  );
}

/** Two clicks, so a single misclick can't remove a resume. */
export function RemoveResumeButton({ resumeId, fileName }: { resumeId: string; fileName: string }) {
  const [state, action] = useActionState(deleteMyResume, initialFormState);
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        <Trash2Icon aria-hidden="true" />
        Remove<span className="sr-only"> {fileName}</span>
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1">
      <input type="hidden" name="resumeId" value={resumeId} />
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
      <SubmitButton variant="destructive" size="sm" pendingLabel="Removing…">
        Confirm remove
      </SubmitButton>
      {state.status === "error" && (
        <p role="alert" className="w-full text-right text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}

// --- Preferences ------------------------------------------------------------

export type MyPreferences = {
  openToOpportunities: boolean;
  desiredTitles: string;
  preferredLocations: string;
  workArrangement: string;
  willingToRelocate: boolean;
  emailJobAlerts: boolean;
  emailApplicationUpdates: boolean;
  phoneContactOk: boolean;
};

export function PreferencesForm({ preferences }: { preferences: MyPreferences }) {
  const [state, action] = useActionState(savePreferences, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-6" noValidate>
      <FormMessage state={state} />

      <fieldset className="grid gap-5">
        <legend className="mb-1 text-base font-semibold text-ink">The work you want</legend>
        <CheckboxField name="openToOpportunities" defaultChecked={preferences.openToOpportunities}>
          I&apos;m open to new opportunities
        </CheckboxField>
        <InputField
          name="desiredTitles"
          label="Roles you're interested in"
          maxLength={300}
          placeholder="Network engineer, SD-WAN architect"
          defaultValue={preferences.desiredTitles}
          error={errors.desiredTitles}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <InputField
            name="preferredLocations"
            label="Preferred locations"
            maxLength={300}
            placeholder="Dallas–Fort Worth, Austin"
            defaultValue={preferences.preferredLocations}
            error={errors.preferredLocations}
          />
          <SelectField
            name="workArrangement"
            label="Work arrangement"
            options={WORK_ARRANGEMENTS}
            placeholder="No preference"
            defaultValue={preferences.workArrangement}
            error={errors.workArrangement}
          />
        </div>
        <CheckboxField name="willingToRelocate" defaultChecked={preferences.willingToRelocate}>
          I&apos;m willing to relocate for the right role
        </CheckboxField>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-base font-semibold text-ink">How we may contact you</legend>
        <CheckboxField name="emailApplicationUpdates" defaultChecked={preferences.emailApplicationUpdates}>
          Email me about my applications and interviews
        </CheckboxField>
        <CheckboxField name="emailJobAlerts" defaultChecked={preferences.emailJobAlerts}>
          Email me about new jobs that match my interests
        </CheckboxField>
        <CheckboxField name="phoneContactOk" defaultChecked={preferences.phoneContactOk}>
          A recruiter may call or text me about suitable roles
        </CheckboxField>
      </fieldset>

      <div>
        <SubmitButton pendingLabel="Saving…">Save preferences</SubmitButton>
      </div>
    </form>
  );
}

// --- Privacy ----------------------------------------------------------------

export function PrivacyRequestForm() {
  const [state, action] = useActionState(submitPrivacyRequest, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-5" noValidate key={state.status === "success" ? "sent" : "form"}>
      <FormMessage state={state} />
      <SelectField
        name="kind"
        label="What would you like us to do?"
        required
        options={PRIVACY_REQUEST_KINDS}
        defaultValue={state.status === "success" ? "" : state.values?.kind}
        error={errors.kind}
      />
      <TextareaField
        name="details"
        label="Details"
        maxLength={2000}
        className="min-h-24"
        hint="For corrections, tell us what should change. Don't include passwords or ID numbers."
        defaultValue={state.status === "success" ? "" : state.values?.details}
        error={errors.details}
      />
      <div>
        <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
      </div>
    </form>
  );
}
