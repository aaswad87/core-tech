"use client";

import Link from "next/link";
import { useActionState } from "react";

import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { specialtyOptions } from "@/content/specialties";
import { initialFormState } from "@/lib/forms";
import { submitLead } from "@/lib/leads/actions";
import { CONTACT_TOPICS, HIRING_TIMELINES, type LeadType } from "@/lib/validation/leads";

type LeadFormProps = {
  type: LeadType;
  /** Page the form is on, stored with the lead. */
  sourcePath: string;
  submitLabel: string;
  defaults?: { topic?: string; specialty?: string };
  /** Published job the candidate is asking about. */
  job?: { id: string; title: string };
};

export function LeadForm({ type, sourcePath, submitLabel, defaults, job }: LeadFormProps) {
  const [state, action] = useActionState(submitLead, initialFormState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};

  if (state.status === "success") {
    return <FormMessage state={state} />;
  }

  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="sourcePath" value={sourcePath} />
      {job && <input type="hidden" name="jobId" value={job.id} />}

      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`website-${type}`}>Website</label>
        <input id={`website-${type}`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {job && (
        <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
          About the role: <span className="font-medium">{job.title}</span>
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <InputField name="fullName" label="Full name" autoComplete="name" required maxLength={200} defaultValue={v.fullName} error={e.fullName} />
        <InputField name="email" label="Email" type="email" autoComplete="email" required maxLength={254} defaultValue={v.email} error={e.email} />
        <InputField name="phone" label="Phone" type="tel" autoComplete="tel" maxLength={40} defaultValue={v.phone} error={e.phone} />

        {type === "contact" && (
          <SelectField name="topic" label="Topic" required options={CONTACT_TOPICS} defaultValue={v.topic ?? defaults?.topic ?? ""} error={e.topic} />
        )}

        {type === "employer" && (
          <>
            <InputField name="companyName" label="Company" autoComplete="organization" required maxLength={200} defaultValue={v.companyName} error={e.companyName} />
            <InputField name="contactTitle" label="Your title" autoComplete="organization-title" maxLength={200} defaultValue={v.contactTitle} error={e.contactTitle} />
            <InputField name="roleTitle" label="Role you're hiring for" required maxLength={200} defaultValue={v.roleTitle} error={e.roleTitle} />
            <InputField name="location" label="Job location" hint="City and state, or remote." maxLength={200} defaultValue={v.location} error={e.location} />
            <InputField name="positionsCount" label="Number of openings" type="number" inputMode="numeric" min={1} max={100} defaultValue={v.positionsCount} error={e.positionsCount} />
            <SelectField name="timeline" label="Hiring timeline" options={HIRING_TIMELINES} defaultValue={v.timeline ?? ""} error={e.timeline} />
          </>
        )}

        {type === "candidate" && (
          <>
            <SelectField name="specialty" label="Area of interest" required options={specialtyOptions} defaultValue={v.specialty ?? defaults?.specialty ?? ""} error={e.specialty} />
            <InputField name="contactTitle" label="Current title" autoComplete="organization-title" maxLength={200} defaultValue={v.contactTitle} error={e.contactTitle} />
            <InputField name="location" label="Location" hint="City and state." autoComplete="address-level2" maxLength={200} defaultValue={v.location} error={e.location} />
          </>
        )}
      </div>

      <TextareaField
        name="message"
        label={type === "employer" ? "Anything else about the role?" : type === "candidate" ? "What are you looking for?" : "Message"}
        required={type === "contact"}
        maxLength={5000}
        defaultValue={v.message}
        error={e.message}
      />

      <CheckboxField name="consent" required error={e.consent}>
        I agree that CoreTech Recruiting may store this information and contact me about my inquiry, as described in
        the{" "}
        <Link href="/privacy" className="text-primary underline underline-offset-4">
          privacy policy
        </Link>
        .
      </CheckboxField>

      <div>
        <SubmitButton size="lg" className="h-11 px-6" pendingLabel="Sending…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
