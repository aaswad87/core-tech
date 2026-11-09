"use client";

import { useActionState, useState } from "react";

import { applyToJob, withdrawApplication } from "@/app/jobs/actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";

export function ApplyButton({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(applyToJob, initialFormState);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="jobId" value={jobId} />
      <FormMessage state={state} />
      <SubmitButton size="lg" className="h-11 w-full rounded-full bg-gradient-to-r from-brand to-teal shadow-md shadow-brand/25" pendingLabel="Sending…">
        Apply for this job
      </SubmitButton>
      <p className="text-xs text-muted-foreground">
        We&apos;ll share your profile with an employer only after you agree to it for this specific role.
      </p>
    </form>
  );
}

export function WithdrawButton({ applicationId, jobTitle }: { applicationId: string; jobTitle: string }) {
  const [state, action] = useActionState(withdrawApplication, initialFormState);
  const [armed, setArmed] = useState(false);

  if (state.status === "success") return <span className="text-sm text-muted-foreground">Withdrawn</span>;
  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        Withdraw<span className="sr-only"> application for {jobTitle}</span>
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Keep
      </Button>
      <SubmitButton variant="destructive" size="sm" pendingLabel="Withdrawing…">
        Confirm withdraw
      </SubmitButton>
      {state.status === "error" && <span role="alert" className="text-sm text-destructive">{state.message}</span>}
    </form>
  );
}
