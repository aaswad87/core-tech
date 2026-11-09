"use client";

import Link from "next/link";
import { useActionState } from "react";

import { saveJob } from "@/app/recruiter/jobs/actions";
import { InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";
import { EMPLOYMENT_TYPES, JOB_STATUSES, WORK_ARRANGEMENT_OPTIONS } from "@/lib/jobs/validation";

type Option = { id: string; name: string };

export function JobForm({
  jobId,
  companies,
  staff,
  initial = {},
  cancelHref,
}: {
  jobId?: string;
  companies: Option[];
  staff: Option[];
  initial?: Partial<Record<string, string>>;
  cancelHref: string;
}) {
  const [state, action] = useActionState(saveJob, initialFormState);
  const v = { ...initial, ...state.values };
  const e = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-8" noValidate>
      {jobId && <input type="hidden" name="jobId" value={jobId} />}
      <FormMessage state={state} />

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold text-ink">Role</legend>
        <div className="sm:col-span-2">
          <InputField name="title" label="Job title" required maxLength={200} defaultValue={v.title} error={e.title} />
        </div>
        <SelectField
          name="companyId"
          label="Company"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Choose a company…"
          defaultValue={v.companyId ?? ""}
          error={e.companyId}
          hint="Or add a new company below."
        />
        <InputField name="newCompanyName" label="New company" maxLength={200} defaultValue={v.newCompanyName} error={e.newCompanyName} />
        <SelectField name="status" label="Status" required options={JOB_STATUSES} placeholder="Choose…" defaultValue={v.status ?? "draft"} error={e.status} hint="Only Published jobs appear on the public job board." />
        <SelectField name="ownerId" label="Owner" options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder={jobId ? "No owner" : "Me"} defaultValue={v.ownerId ?? ""} error={e.ownerId} />
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold text-ink">Location and terms</legend>
        <InputField name="location" label="Location" hint="City and state." maxLength={200} defaultValue={v.location} error={e.location} />
        <SelectField name="workArrangement" label="Work arrangement" options={WORK_ARRANGEMENT_OPTIONS} placeholder="Not specified" defaultValue={v.workArrangement ?? ""} error={e.workArrangement} />
        <SelectField
          name="employmentType"
          label="Employment type"
          required
          options={EMPLOYMENT_TYPES}
          placeholder="Choose…"
          defaultValue={v.employmentType ?? "direct_hire"}
          error={e.employmentType}
          hint="Contract staffing isn't set up for live payroll yet — direct hire is the default."
        />
        <div className="grid grid-cols-2 gap-3">
          <InputField name="salaryMin" label="Salary from (USD)" inputMode="numeric" defaultValue={v.salaryMin} error={e.salaryMin} />
          <InputField name="salaryMax" label="Salary to (USD)" inputMode="numeric" defaultValue={v.salaryMax} error={e.salaryMax} />
        </div>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold text-ink">Skills</legend>
        <TextareaField name="requiredSkills" label="Required skills" className="min-h-20" hint="Comma or line separated, e.g. BGP, OSPF, CCNP" defaultValue={v.requiredSkills} error={e.requiredSkills} />
        <TextareaField name="preferredSkills" label="Preferred skills" className="min-h-20" hint="Nice to have." defaultValue={v.preferredSkills} error={e.preferredSkills} />
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-3 text-lg font-semibold text-ink">Descriptions</legend>
        <TextareaField name="publicSummary" label="Public summary" className="min-h-20" maxLength={2000} hint="Shown on the public job board. Required to publish." defaultValue={v.publicSummary} error={e.publicSummary} />
        <TextareaField name="publicDescription" label="Public description" className="min-h-40" maxLength={20000} hint="Responsibilities and requirements candidates will see. Don't include the client's name if it's confidential." defaultValue={v.publicDescription} error={e.publicDescription} />
        <TextareaField name="description" label="Internal notes" className="min-h-28" maxLength={20000} hint="Staff only — never shown publicly or to the employer." defaultValue={v.description} error={e.description} />
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <SubmitButton size="lg" className="h-10 rounded-full px-5" pendingLabel="Saving…">
          {jobId ? "Save job" : "Create job"}
        </SubmitButton>
        <Button asChild variant="outline" size="lg" className="h-10 rounded-full px-5">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
