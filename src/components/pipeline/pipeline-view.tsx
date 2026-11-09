"use client";

import { ArrowRightLeftIcon, ClockIcon, GripVerticalIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useOptimistic, useState, useTransition } from "react";

import { moveApplication } from "@/app/recruiter/pipeline/actions";
import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type FormState, initialFormState } from "@/lib/forms";
import type { PipelineCard } from "@/lib/jobs/staff-queries";
import {
  daysSince,
  defaultDisplayName,
  isClosedStage,
  STAGES,
  stageLabel,
  stageRequiresReason,
  stageTone,
  SUBMIT_STAGE,
} from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

type Props = {
  cards: PipelineCard[];
  view: "board" | "table";
  /** Show the job on each card (cross-job pipeline). */
  showJob: boolean;
  actorNames: Record<string, string>;
};

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

function needsDetails(from: string, to: string) {
  return stageRequiresReason(to) || to === SUBMIT_STAGE || from === "placed";
}

export function PipelineView({ cards, view, showJob, actorNames }: Props) {
  const [optimisticCards, setOptimistic] = useOptimistic(cards, (state, move: { id: string; stage: string }) =>
    state.map((c) => (c.id === move.id ? { ...c, stage: move.stage, stageChangedAt: new Date().toISOString() } : c)),
  );
  const [panel, setPanel] = useState<{ card: PipelineCard; stage: string } | null>(null);
  const [notice, setNotice] = useState<FormState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(() => cards.some((c) => isClosedStage(c.stage)));
  const [, startTransition] = useTransition();

  function requestMove(card: PipelineCard, stage: string) {
    if (stage === card.stage) return;
    if (needsDetails(card.stage, stage)) {
      setPanel({ card, stage });
      return;
    }
    startTransition(async () => {
      setOptimistic({ id: card.id, stage });
      const fd = new FormData();
      fd.set("applicationId", card.id);
      fd.set("stage", stage);
      fd.set("jobId", card.job.id);
      setNotice(await moveApplication(initialFormState, fd));
    });
  }

  const visibleStages = STAGES.filter((s) => s.group === "active" || showClosed);
  const closedCount = optimisticCards.filter((c) => isClosedStage(c.stage)).length;

  return (
    <div className="grid gap-4">
      <div aria-live="polite" className="min-h-0">
        {notice && notice.status !== "idle" && <FormMessage state={notice} />}
      </div>

      {view === "board" ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Drag a card to another stage, or use its Move button.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowClosed((v) => !v)} aria-pressed={showClosed}>
              {showClosed ? "Hide closed stages" : `Show closed stages (${closedCount})`}
            </Button>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
            <ol className="flex min-w-max gap-3" aria-label="Pipeline stages">
              {visibleStages.map((s) => {
                const inStage = optimisticCards.filter((c) => c.stage === s.value);
                return (
                  <li
                    key={s.value}
                    aria-label={`${s.label}, ${inStage.length} ${inStage.length === 1 ? "candidate" : "candidates"}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(s.value);
                    }}
                    onDragLeave={() => setDragOver((v) => (v === s.value ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(null);
                      const card = optimisticCards.find((c) => c.id === e.dataTransfer.getData("text/plain"));
                      if (card) requestMove(card, s.value);
                    }}
                    className={cn(
                      "flex w-72 shrink-0 flex-col rounded-2xl border bg-surface transition-colors",
                      dragOver === s.value ? "border-brand ring-2 ring-brand/30" : "border-border",
                    )}
                  >
                    <div className={cn("flex items-center justify-between rounded-t-2xl border-b px-3 py-2", stageTone(s.value))}>
                      <h3 className="text-sm font-semibold">{s.label}</h3>
                      <span className="rounded-full bg-white/70 px-2 text-xs font-medium">{inStage.length}</span>
                    </div>
                    <ul className="grid min-h-28 content-start gap-2 p-2">
                      {inStage.map((card) => (
                        <li
                          key={card.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", card.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="group rounded-xl border border-border bg-background p-3 shadow-sm transition-shadow hover:shadow-md"
                        >
                          <div className="flex items-start gap-1.5">
                            <GripVerticalIcon className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <Link href={`/recruiter/candidates/${card.candidate.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                                {card.candidate.firstName} {card.candidate.lastName}
                              </Link>
                              {card.candidate.headline && <p className="truncate text-xs text-muted-foreground">{card.candidate.headline}</p>}
                              {showJob && (
                                <Link href={`/recruiter/jobs/${card.job.id}`} className="mt-1 block truncate text-xs text-brand hover:underline">
                                  {card.job.title}
                                  {card.job.companyName && ` · ${card.job.companyName}`}
                                </Link>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Days in this stage">
                              <ClockIcon className="size-3" aria-hidden="true" /> {daysSince(card.stageChangedAt)}d
                            </span>
                            <Button type="button" variant="ghost" size="xs" onClick={() => setPanel({ card, stage: card.stage })}>
                              <ArrowRightLeftIcon aria-hidden="true" /> Move
                              <span className="sr-only">
                                {" "}
                                {card.candidate.firstName} {card.candidate.lastName}
                              </span>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">Candidate</th>
                {showJob && <th scope="col" className="px-4 py-3">Job</th>}
                <th scope="col" className="px-4 py-3">Stage</th>
                <th scope="col" className="px-4 py-3">In stage</th>
                <th scope="col" className="px-4 py-3">Applied</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {optimisticCards.length === 0 && (
                <tr>
                  <td colSpan={showJob ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">No candidates in this view.</td>
                </tr>
              )}
              {optimisticCards.map((card) => (
                <tr key={card.id}>
                  <td className="px-4 py-3">
                    <Link href={`/recruiter/candidates/${card.candidate.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                      {card.candidate.firstName} {card.candidate.lastName}
                    </Link>
                    {card.candidate.headline && <div className="text-xs text-muted-foreground">{card.candidate.headline}</div>}
                  </td>
                  {showJob && (
                    <td className="px-4 py-3">
                      <Link href={`/recruiter/jobs/${card.job.id}`} className="text-brand hover:underline">{card.job.title}</Link>
                      {card.job.companyName && <div className="text-xs text-muted-foreground">{card.job.companyName}</div>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", stageTone(card.stage))}>{stageLabel(card.stage)}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{daysSince(card.stageChangedAt)} days</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{dateTime.format(new Date(card.createdAt))}</td>
                  <td className="px-4 py-3 text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPanel({ card, stage: card.stage })}>
                      Move<span className="sr-only"> {card.candidate.firstName} {card.candidate.lastName}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {panel && (
            <MovePanel
              key={`${panel.card.id}:${panel.stage}`}
              card={panel.card}
              presetStage={panel.stage}
              actorNames={actorNames}
              onDone={(result) => {
                setNotice(result);
                setPanel(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MovePanel({
  card,
  presetStage,
  actorNames,
  onDone,
}: {
  card: PipelineCard;
  presetStage: string;
  actorNames: Record<string, string>;
  onDone: (result: FormState) => void;
}) {
  const [state, action] = useActionState(moveApplication, initialFormState);
  const [stage, setStage] = useState(presetStage);

  useEffect(() => {
    if (state.status === "success") onDone(state);
  }, [state, onDone]);

  const e = state.fieldErrors ?? {};
  const name = `${card.candidate.firstName} ${card.candidate.lastName}`;

  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle>Move {name}</SheetTitle>
        <SheetDescription>
          {card.job.title}
          {card.job.companyName && ` · ${card.job.companyName}`} — currently {stageLabel(card.stage)}
        </SheetDescription>
      </SheetHeader>

      <form action={action} className="grid gap-4 px-4" noValidate>
        <input type="hidden" name="applicationId" value={card.id} />
        <input type="hidden" name="jobId" value={card.job.id} />
        {state.status === "error" && state.message && <FormMessage state={state} />}

        <SelectField
          name="stage"
          label="Move to"
          required
          options={STAGES.map((s) => ({ value: s.value, label: s.value === card.stage ? `${s.label} (current)` : s.label }))}
          value={stage}
          onChange={(ev) => setStage(ev.target.value)}
        />

        {stage === SUBMIT_STAGE ? (
          <div className="grid gap-4 rounded-xl border border-brand/20 bg-brand-50/50 p-3">
            <p className="text-sm text-ink">
              The employer will see <strong>only</strong> the name and summary below — never internal notes, contact
              details or other applications.
            </p>
            <InputField name="displayName" label="Name shown to the employer" required maxLength={200} defaultValue={defaultDisplayName(card.candidate.firstName, card.candidate.lastName)} error={e.displayName} />
            <TextareaField name="sharedSummary" label="Summary shared with the employer" maxLength={5000} className="min-h-28" hint="Job-related experience and skills only." error={e.sharedSummary} />
            <CheckboxField name="consent" required error={e.consent}>
              {card.candidate.firstName} agreed to be submitted to this employer for this role.
            </CheckboxField>
          </div>
        ) : (
          <TextareaField
            name="reason"
            label={stageRequiresReason(stage) ? "Reason" : "Note"}
            required={stageRequiresReason(stage)}
            maxLength={1000}
            className="min-h-24"
            hint={stageRequiresReason(stage) ? "Required. Kept in the stage history; staff only." : "Optional. Kept in the stage history; staff only."}
            error={e.reason}
          />
        )}

        {card.stage === "placed" && <p className="text-sm text-muted-foreground">Only an administrator can move a candidate out of Placed.</p>}

        <SubmitButton disabled={stage === card.stage} className="h-10 rounded-full" pendingLabel="Saving…">
          {stage === SUBMIT_STAGE ? "Submit to employer" : `Move to ${stageLabel(stage)}`}
        </SubmitButton>
      </form>

      <section aria-labelledby={`history-${card.id}`} className="mt-2 border-t border-border px-4 pt-4 pb-6">
        <h3 id={`history-${card.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <HistoryIcon className="size-4" aria-hidden="true" /> Stage history
        </h3>
        {card.history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <ol className="mt-3 grid gap-3">
            {card.history.map((h, i) => (
              <li key={i} className="text-sm">
                <p>
                  {h.fromStage ? `${stageLabel(h.fromStage)} → ` : "Added as "}
                  <span className="font-medium">{stageLabel(h.toStage)}</span>
                </p>
                {h.reason && <p className="text-muted-foreground">“{h.reason}”</p>}
                <p className="text-xs text-muted-foreground">
                  {h.actorId ? (actorNames[h.actorId] ?? "Team member") : "System"} · {dateTime.format(new Date(h.createdAt))} CT
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
