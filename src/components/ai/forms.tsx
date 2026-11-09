"use client";

import { SparklesIcon } from "lucide-react";
import { useActionState } from "react";

import { applyAiProposal, discardAiProposal, parseResumeWithAi } from "@/app/recruiter/candidates/[id]/ai/actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Badge } from "@/components/ui/badge";
import { type Confidence, preselect, type ReviewedProposal } from "@/lib/ai/proposal";
import { initialFormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

export function AiParseButton({ candidateId, resumeId, fileName }: { candidateId: string; resumeId: string; fileName: string }) {
  const [state, action] = useActionState(parseResumeWithAi, initialFormState);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="resumeId" value={resumeId} />
      <div>
        <SubmitButton variant="ghost" size="sm" pendingLabel="Reading resume… (up to a minute)">
          <SparklesIcon aria-hidden="true" /> Suggest profile details<span className="sr-only"> from {fileName}</span>
        </SubmitButton>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}

function Meta({ verified, confidence, evidence }: { verified: boolean; confidence: Confidence; evidence?: string | null }) {
  return (
    <span className="grid gap-1">
      <span className="flex flex-wrap gap-1">
        <Badge variant="outline" className={cn(confidence === "low" && "border-amber-400 text-amber-900")}>
          {confidence} confidence
        </Badge>
        {evidence !== undefined && (
          <Badge variant="outline" className={cn(!verified && "border-destructive/50 text-destructive")}>
            {verified ? "quote found in resume" : "quote NOT found — check carefully"}
          </Badge>
        )}
      </span>
      {evidence && <q className="text-xs text-muted-foreground italic">{evidence}</q>}
    </span>
  );
}

const box = "mt-1 size-4 shrink-0 accent-brand";
const input =
  "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function AiReviewForm({ parseId, candidateId, proposal }: { parseId: string; candidateId: string; proposal: ReviewedProposal }) {
  const [state, action] = useActionState(applyAiProposal, initialFormState);
  const [discardState, discard] = useActionState(discardAiProposal, initialFormState);
  const p = proposal;

  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-6">
        <input type="hidden" name="parseId" value={parseId} />
        <FormMessage state={state} />

        <fieldset className="grid gap-4 rounded-xl border border-border bg-background p-5">
          <legend className="px-1 text-base font-semibold text-ink">Profile</legend>
          {(
            [
              ["headline", "Headline", p.headline.value, p.headline.confidence, p.verified.headline, p.headline.evidence],
              ["location", "Location", p.location.value, p.location.confidence, p.verified.location, p.location.evidence],
              ["summary", "Summary (written by the AI — edit before saving)", p.summary.value, p.summary.confidence, false, undefined],
            ] as const
          )
            .filter(([, , value]) => value)
            .map(([key, label, value, confidence, verified, evidence]) => (
              <div key={key} className="flex items-start gap-3">
                <input
                  id={`use_${key}`}
                  name={`use_${key}`}
                  type="checkbox"
                  className={box}
                  defaultChecked={key === "summary" ? false : preselect(verified, confidence)}
                />
                <div className="grid flex-1 gap-1">
                  <label htmlFor={`use_${key}`} className="text-sm font-medium">
                    {label} — replaces the current value
                  </label>
                  {key === "summary" ? (
                    <textarea name={key} defaultValue={value ?? ""} maxLength={5000} className={cn(input, "min-h-20")} aria-label={label} />
                  ) : (
                    <input name={key} defaultValue={value ?? ""} maxLength={200} className={input} aria-label={label} />
                  )}
                  <Meta verified={verified} confidence={confidence} evidence={evidence} />
                </div>
              </div>
            ))}
        </fieldset>

        {(
          [
            ["skill", "Skills", p.skills.map((s, i) => ({ label: `${s.name}${s.years_experience != null ? ` · ${s.years_experience} yrs` : ""}`, s, v: p.verified.skills[i] }))],
            ["certification", "Certifications", p.certifications.map((c, i) => ({ label: [c.name, c.issuer].filter(Boolean).join(" · "), s: c, v: p.verified.certifications[i] }))],
            [
              "work",
              "Work history",
              p.work_history.map((w, i) => ({
                label: `${w.title} at ${w.company} (${w.start_month ?? "?"} – ${w.is_current ? "present" : (w.end_month ?? "?")})`,
                s: w,
                v: p.verified.work_history[i],
              })),
            ],
          ] as const
        ).map(([name, title, items]) =>
          items.length === 0 ? null : (
            <fieldset key={name} className="grid gap-3 rounded-xl border border-border bg-background p-5">
              <legend className="px-1 text-base font-semibold text-ink">
                {title} ({items.length})
              </legend>
              {items.map((item, i) => (
                <label key={i} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name={name} value={i} className={box} defaultChecked={preselect(item.v, item.s.confidence)} />
                  <span className="grid gap-1">
                    <span className="font-medium">{item.label}</span>
                    <Meta verified={item.v} confidence={item.s.confidence} evidence={item.s.evidence} />
                  </span>
                </label>
              ))}
            </fieldset>
          ),
        )}

        {p.uncertainties.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">The AI flagged these uncertainties</p>
            <ul className="mt-1 list-disc pl-5">
              {p.uncertainties.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save selected to the candidate</SubmitButton>
          <p className="text-xs text-muted-foreground">Skills already on the record are skipped. You can edit anything afterwards.</p>
        </div>
      </form>

      <form action={discard}>
        <input type="hidden" name="parseId" value={parseId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <SubmitButton variant="ghost" pendingLabel="Discarding…">
          Discard all suggestions
        </SubmitButton>
        {discardState.status === "error" && <p className="text-sm text-destructive">{discardState.message}</p>}
      </form>
    </div>
  );
}
