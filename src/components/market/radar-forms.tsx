"use client";

import { RadarIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import {
  addWatchCompany,
  huntCommand,
  pursueMatch,
  removeWatchCompany,
  runScanNow,
  saveHunt,
  setMatchStatus,
} from "@/app/recruiter/market/actions";
import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { type FormState, initialFormState } from "@/lib/forms";
import { MARKET_SOURCES, type MarketSource, SOURCE_LABELS } from "@/lib/market/types";

function Status({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

export function RunScanButton({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const [state, action] = useActionState(runScanNow, initialFormState);
  return (
    <form action={action} className="grid gap-2">
      <SubmitButton
        size="lg"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className="h-10 rounded-full bg-gradient-to-r from-brand to-teal px-5 shadow-md shadow-brand/25 hover:opacity-95"
        pendingLabel="Scanning job boards…"
      >
        <RadarIcon aria-hidden="true" /> Run scan now
      </SubmitButton>
      {disabled && disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      <Status state={state} />
    </form>
  );
}

type HuntDefaults = {
  name?: string;
  keywords?: string;
  excludeKeywords?: string;
  locations?: string;
  includeRemote?: boolean;
  sources?: MarketSource[];
  minScore?: number;
};

export function HuntForm({ huntId, defaults = {} }: { huntId?: string; defaults?: HuntDefaults }) {
  const [state, action] = useActionState(saveHunt, initialFormState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const selectedSources = v.sources !== undefined ? v.sources.split(",") : (defaults.sources ?? [...MARKET_SOURCES]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      {huntId && <input type="hidden" name="huntId" value={huntId} />}
      <FormMessage state={state} />
      <InputField name="name" label="Hunt name" required maxLength={120} placeholder="e.g. Texas network engineering" defaultValue={v.name ?? defaults.name} error={e.name} />
      <TextareaField
        name="keywords"
        label="Keywords"
        required
        className="min-h-24"
        hint="Comma or line separated. A match in the job title counts 3 points, in the description 1 point. e.g. network engineer, BGP, SD-WAN, CCNP"
        defaultValue={v.keywords ?? defaults.keywords}
        error={e.keywords}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextareaField
          name="locations"
          label="Locations"
          className="min-h-20"
          hint="States or cities, e.g. Texas, Dallas, Oklahoma. Leave empty for anywhere in the US."
          defaultValue={v.locations ?? defaults.locations}
          error={e.locations}
        />
        <TextareaField
          name="excludeKeywords"
          label="Exclude postings containing"
          className="min-h-20"
          hint="e.g. intern, contract-to-hire, sales"
          defaultValue={v.excludeKeywords ?? defaults.excludeKeywords}
          error={e.excludeKeywords}
        />
      </div>
      <CheckboxField name="includeRemote" defaultChecked={v.includeRemote !== undefined ? v.includeRemote === "on" : (defaults.includeRemote ?? true)}>
        Also include remote jobs outside these locations
      </CheckboxField>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Sources</legend>
        {MARKET_SOURCES.map((s) => (
          <label key={s} className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="sources" value={s} defaultChecked={selectedSources.includes(s)} className="mt-0.5 size-4 accent-brand" />
            {SOURCE_LABELS[s]}
          </label>
        ))}
        {e.sources && <p className="text-sm text-destructive">{e.sources}</p>}
      </fieldset>
      <InputField
        name="minScore"
        label="Minimum fit score"
        type="number"
        min={1}
        max={30}
        required
        className="max-w-32"
        hint="3 = at least one keyword in the title. Raise it to get fewer, stronger alerts."
        defaultValue={v.minScore ?? String(defaults.minScore ?? 3)}
        error={e.minScore}
      />
      <div className="flex flex-wrap gap-3">
        <SubmitButton size="lg" className="h-10 rounded-full px-5" pendingLabel="Saving…">
          {huntId ? "Save hunt" : "Create hunt"}
        </SubmitButton>
        <Button asChild variant="outline" size="lg" className="h-10 rounded-full px-5">
          <Link href="/recruiter/market/hunts">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

export function HuntCommandButton({
  huntId,
  command,
  label,
  variant = "outline",
  confirm,
}: {
  huntId: string;
  command: "subscribe" | "unsubscribe" | "pause" | "resume" | "delete";
  label: string;
  variant?: "outline" | "ghost" | "destructive" | "default";
  confirm?: boolean;
}) {
  const [state, action] = useActionState(huntCommand, initialFormState);
  const [armed, setArmed] = useState(false);

  if (confirm && !armed) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        <Trash2Icon aria-hidden="true" /> {label}
      </Button>
    );
  }
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="huntId" value={huntId} />
      <input type="hidden" name="command" value={command} />
      <div className="flex gap-1">
        {confirm && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        )}
        <SubmitButton variant={confirm ? "destructive" : variant} size="sm">
          {confirm ? `Confirm ${label.toLowerCase()}` : label}
        </SubmitButton>
      </div>
      {state.status === "error" && <Status state={state} />}
    </form>
  );
}

export function WatchCompanyForm() {
  const [state, action] = useActionState(addWatchCompany, initialFormState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 rounded-2xl border border-dashed border-border p-4 sm:grid-cols-[1fr_10rem_1.5fr_auto] sm:items-start" noValidate>
      <InputField name="companyName" label="Company" required maxLength={200} defaultValue={v.companyName} error={e.companyName} />
      <SelectField
        name="source"
        label="Careers platform"
        required
        options={[
          { value: "greenhouse", label: "Greenhouse" },
          { value: "lever", label: "Lever" },
        ]}
        defaultValue={v.source ?? ""}
        error={e.source}
      />
      <InputField
        name="board"
        label="Careers page link"
        required
        maxLength={300}
        placeholder="https://boards.greenhouse.io/company"
        defaultValue={v.board}
        error={e.board}
      />
      <div className="grid gap-1 sm:pt-6">
        <SubmitButton variant="outline" className="h-10" pendingLabel="Adding…">
          Watch
        </SubmitButton>
        <Status state={state} />
      </div>
    </form>
  );
}

export function RemoveWatchCompanyButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(removeWatchCompany, initialFormState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" aria-label={`Stop watching ${name}`}>
        <Trash2Icon aria-hidden="true" />
      </SubmitButton>
      {state.status === "error" && <Status state={state} />}
    </form>
  );
}

export function MatchActions({ matchId, status, pursued }: { matchId: string; status: string; pursued: boolean }) {
  const [statusState, statusAction] = useActionState(setMatchStatus, initialFormState);
  const [pursueState, pursueAction] = useActionState(pursueMatch, initialFormState);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {!pursued && (
          <form action={pursueAction}>
            <input type="hidden" name="matchId" value={matchId} />
            <SubmitButton className="h-10 rounded-full bg-gradient-to-r from-brand to-teal px-5 shadow-md shadow-brand/25" pendingLabel="Saving…">
              Pursue this opportunity
            </SubmitButton>
          </form>
        )}
        {status !== "reviewing" && !pursued && (
          <form action={statusAction}>
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="status" value="reviewing" />
            <SubmitButton variant="outline" className="h-10 rounded-full px-4">Mark reviewing</SubmitButton>
          </form>
        )}
        {status !== "dismissed" && !pursued && (
          <form action={statusAction}>
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="status" value="dismissed" />
            <SubmitButton variant="ghost" className="h-10 rounded-full px-4">Dismiss</SubmitButton>
          </form>
        )}
        {status === "dismissed" && (
          <form action={statusAction}>
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="status" value="new" />
            <SubmitButton variant="outline" className="h-10 rounded-full px-4">Restore</SubmitButton>
          </form>
        )}
      </div>
      <Status state={pursueState.status !== "idle" ? pursueState : statusState} />
    </div>
  );
}
