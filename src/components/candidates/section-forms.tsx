"use client";

import { Trash2Icon, UploadIcon } from "lucide-react";
import { useActionState, useState } from "react";

import {
  addCertification,
  addNote,
  addSkill,
  addWorkHistory,
  deleteNote,
  deleteResume,
  removeCertification,
  removeSkill,
  removeWorkHistory,
  uploadResume,
} from "@/app/recruiter/candidates/[id]/actions";
import { CheckboxField, FieldShell, InputField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { type FormState, initialFormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function InlineStatus({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

// --- Remove buttons ---------------------------------------------------------

const REMOVE_ACTIONS = {
  skill: removeSkill,
  certification: removeCertification,
  workHistory: removeWorkHistory,
  note: deleteNote,
  resume: deleteResume,
} satisfies Record<string, Action>;

/**
 * Removes one item. `confirm` adds a second click for destructive removals (notes, resumes),
 * so a single misclick can't delete them.
 */
export function RemoveButton({
  kind,
  candidateId,
  rowId,
  label,
  confirm = false,
}: {
  kind: keyof typeof REMOVE_ACTIONS;
  candidateId: string;
  rowId: string;
  label: string;
  confirm?: boolean;
}) {
  const [state, action] = useActionState(REMOVE_ACTIONS[kind], initialFormState);
  const [armed, setArmed] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      {confirm && !armed ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)} aria-label={`Delete ${label}`}>
          <Trash2Icon aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Delete</span>
        </Button>
      ) : (
        <form action={action} className="flex items-center gap-1">
          <input type="hidden" name="candidateId" value={candidateId} />
          <input type="hidden" name="rowId" value={rowId} />
          {confirm && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
              Cancel
            </Button>
          )}
          <SubmitButton
            variant={confirm ? "destructive" : "ghost"}
            size="sm"
            aria-label={confirm ? `Confirm delete ${label}` : `Remove ${label}`}
            pendingLabel={confirm ? "Deleting…" : undefined}
          >
            {confirm ? "Confirm delete" : <Trash2Icon aria-hidden="true" />}
          </SubmitButton>
        </form>
      )}
      {state.status === "error" && <InlineStatus state={state} />}
    </div>
  );
}

// --- Add forms --------------------------------------------------------------

function AddFormShell({
  action,
  candidateId,
  submitLabel,
  children,
  encType,
}: {
  action: Action;
  candidateId: string;
  submitLabel: string;
  children: (state: FormState) => React.ReactNode;
  encType?: "multipart/form-data";
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} encType={encType} className="grid gap-4 rounded-lg border border-dashed border-border p-4" noValidate>
      <input type="hidden" name="candidateId" value={candidateId} />
      {children(state)}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        <InlineStatus state={state} />
      </div>
    </form>
  );
}

export function AddSkillForm({ candidateId }: { candidateId: string }) {
  return (
    <AddFormShell action={addSkill} candidateId={candidateId} submitLabel="Add skill">
      {(s) => (
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <InputField name="name" label="Skill" required maxLength={80} defaultValue={s.values?.name} error={s.fieldErrors?.name} />
          <InputField
            name="yearsExperience"
            label="Years"
            type="number"
            inputMode="decimal"
            min={0}
            max={60}
            step={0.5}
            defaultValue={s.values?.yearsExperience}
            error={s.fieldErrors?.yearsExperience}
          />
        </div>
      )}
    </AddFormShell>
  );
}

export function AddCertificationForm({ candidateId }: { candidateId: string }) {
  return (
    <AddFormShell action={addCertification} candidateId={candidateId} submitLabel="Add certification">
      {(s) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField name="name" label="Certification" required maxLength={200} defaultValue={s.values?.name} error={s.fieldErrors?.name} />
          <InputField name="issuer" label="Issuer" maxLength={200} defaultValue={s.values?.issuer} error={s.fieldErrors?.issuer} />
          <InputField name="credentialId" label="Credential ID" maxLength={100} defaultValue={s.values?.credentialId} error={s.fieldErrors?.credentialId} />
          <div className="grid grid-cols-2 gap-3">
            <InputField name="issuedOn" label="Issued" type="date" defaultValue={s.values?.issuedOn} error={s.fieldErrors?.issuedOn} />
            <InputField name="expiresOn" label="Expires" type="date" defaultValue={s.values?.expiresOn} error={s.fieldErrors?.expiresOn} />
          </div>
        </div>
      )}
    </AddFormShell>
  );
}

export function AddWorkHistoryForm({ candidateId }: { candidateId: string }) {
  return (
    <AddFormShell action={addWorkHistory} candidateId={candidateId} submitLabel="Add position">
      {(s) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField name="title" label="Title" required maxLength={200} defaultValue={s.values?.title} error={s.fieldErrors?.title} />
          <InputField name="companyName" label="Company" required maxLength={200} defaultValue={s.values?.companyName} error={s.fieldErrors?.companyName} />
          <InputField name="location" label="Location" maxLength={200} defaultValue={s.values?.location} error={s.fieldErrors?.location} />
          <div className="grid grid-cols-2 gap-3">
            <InputField name="startDate" label="Start" type="month" defaultValue={s.values?.startDate} error={s.fieldErrors?.startDate} />
            <InputField name="endDate" label="End" type="month" defaultValue={s.values?.endDate} error={s.fieldErrors?.endDate} />
          </div>
          <div className="sm:col-span-2">
            <CheckboxField name="isCurrent" defaultChecked={s.values?.isCurrent === "on"}>
              Current position
            </CheckboxField>
          </div>
          <div className="sm:col-span-2">
            <TextareaField name="description" label="Description" maxLength={5000} className="min-h-20" defaultValue={s.values?.description} error={s.fieldErrors?.description} />
          </div>
        </div>
      )}
    </AddFormShell>
  );
}

export function AddNoteForm({ candidateId }: { candidateId: string }) {
  const [state, action] = useActionState(addNote, initialFormState);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="candidateId" value={candidateId} />
      <TextareaField
        name="body"
        label="New internal note"
        required
        maxLength={10000}
        className="min-h-24"
        hint="Visible to CoreTech staff only — never to candidates or employers."
        defaultValue={state.values?.body}
        error={state.fieldErrors?.body}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Add note</SubmitButton>
        <InlineStatus state={state} />
      </div>
    </form>
  );
}

export function ResumeUploadForm({ candidateId }: { candidateId: string }) {
  const [state, action] = useActionState(uploadResume, initialFormState);
  return (
    <form action={action} encType="multipart/form-data" className="grid gap-3" noValidate>
      <input type="hidden" name="candidateId" value={candidateId} />
      <FieldShell name="resume" label="Upload a resume" required hint="PDF or Word (.docx), up to 4 MB." error={state.fieldErrors?.resume}>
        {({ id, describedBy }) => (
          <input
            id={id}
            name="resume"
            type="file"
            required
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-describedby={describedBy}
            aria-invalid={state.fieldErrors?.resume ? true : undefined}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
          />
        )}
      </FieldShell>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline" pendingLabel="Uploading…">
          <UploadIcon aria-hidden="true" /> Upload
        </SubmitButton>
        {state.status !== "idle" && !state.fieldErrors && <FormMessage state={state} />}
      </div>
    </form>
  );
}
