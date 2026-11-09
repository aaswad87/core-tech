"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { createCandidate, type CandidateFormState, updateCandidate } from "@/app/recruiter/candidates/actions";
import { DuplicateList } from "@/components/candidates/duplicate-list";
import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { StaffMember } from "@/lib/candidates/types";

type CandidateFormProps = {
  mode: "create" | "edit";
  staff: StaffMember[];
  /** Initial values (edit) — keys match form field names. */
  initial?: Partial<Record<string, string>>;
  candidateId?: string;
  cancelHref: string;
};

const initialState: CandidateFormState = { status: "idle" };

export function CandidateForm({ mode, staff, initial = {}, candidateId, cancelHref }: CandidateFormProps) {
  const [state, action] = useActionState(mode === "create" ? createCandidate : updateCandidate, initialState);
  const v = { ...initial, ...state.values };
  const e = state.fieldErrors ?? {};
  const hasDuplicates = Boolean(state.duplicates?.length);

  return (
    <form action={action} className="grid gap-6" noValidate>
      {candidateId && <input type="hidden" name="candidateId" value={candidateId} />}

      {hasDuplicates ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <TriangleAlertIcon />
          <AlertTitle>Possible duplicate</AlertTitle>
          <AlertDescription className="grid gap-3 text-amber-950">
            <p>{state.message}</p>
            <DuplicateList matches={state.duplicates!} />
            <CheckboxField name="confirmDuplicates">
              I checked these matches — this is a different person. Save anyway.
            </CheckboxField>
          </AlertDescription>
        </Alert>
      ) : (
        <FormMessage state={state} />
      )}

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold text-ink">Contact</legend>
        <InputField name="firstName" label="First name" required maxLength={100} defaultValue={v.firstName} error={e.firstName} />
        <InputField name="lastName" label="Last name" required maxLength={100} defaultValue={v.lastName} error={e.lastName} />
        <InputField name="email" label="Email" type="email" maxLength={254} defaultValue={v.email} error={e.email} />
        <InputField name="phone" label="Phone" type="tel" maxLength={40} defaultValue={v.phone} error={e.phone} />
        <InputField name="location" label="Location" hint="City and state." maxLength={200} defaultValue={v.location} error={e.location} />
        <InputField name="source" label="Source" hint="Where this candidate came from, e.g. referral or LinkedIn." maxLength={100} defaultValue={v.source} error={e.source} />
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-3 text-lg font-semibold text-ink">Profile</legend>
        <InputField name="headline" label="Headline" hint="e.g. Senior Network Engineer · CCNP" maxLength={200} defaultValue={v.headline} error={e.headline} />
        <TextareaField name="summary" label="Summary" maxLength={5000} defaultValue={v.summary} error={e.summary} />
        <InputField
          name="tags"
          label="Tags"
          hint="Comma-separated, e.g. ccnp, open to relocation. Lowercase letters, numbers, spaces and + # . / -"
          maxLength={900}
          defaultValue={v.tags}
          error={e.tags}
        />
        <SelectField
          name="ownerId"
          label="Owner"
          hint={mode === "create" ? "Defaults to you. Only the owner or an administrator can reassign later." : "Only the current owner or an administrator can reassign."}
          options={staff.map((s) => ({ value: s.id, label: s.name }))}
          placeholder={mode === "create" ? "Me" : "No owner"}
          defaultValue={v.ownerId ?? ""}
          error={e.ownerId}
        />
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <SubmitButton size="lg" className="h-10 px-5" pendingLabel="Saving…">
          {hasDuplicates ? "Save candidate" : mode === "create" ? "Add candidate" : "Save changes"}
        </SubmitButton>
        <Button asChild variant="outline" size="lg" className="h-10 px-5">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
