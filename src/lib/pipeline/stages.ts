/** Mirrors `public.application_stage`. Order is the board's left-to-right order. */
export const STAGES = [
  { value: "new", label: "New", group: "active", tone: "bg-slate-100 text-slate-800 border-slate-200" },
  { value: "screening", label: "Screening", group: "active", tone: "bg-sky-50 text-sky-900 border-sky-200" },
  { value: "recruiter_interview", label: "Recruiter Interview", group: "active", tone: "bg-indigo-50 text-indigo-900 border-indigo-200" },
  { value: "technical_evaluation", label: "Technical Evaluation", group: "active", tone: "bg-violet-50 text-violet-900 border-violet-200" },
  { value: "submitted_to_client", label: "Submitted to Client", group: "active", tone: "bg-fuchsia-50 text-fuchsia-900 border-fuchsia-200" },
  { value: "client_interview", label: "Client Interview", group: "active", tone: "bg-purple-50 text-purple-900 border-purple-200" },
  { value: "offer", label: "Offer", group: "active", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  { value: "on_hold", label: "On Hold", group: "active", tone: "bg-stone-100 text-stone-800 border-stone-200" },
  { value: "placed", label: "Placed / Hired", group: "closed", tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  { value: "rejected", label: "Rejected", group: "closed", tone: "bg-rose-50 text-rose-900 border-rose-200" },
  { value: "withdrawn", label: "Withdrawn", group: "closed", tone: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  { value: "future_opportunity", label: "Future Opportunity", group: "closed", tone: "bg-teal-50 text-teal-900 border-teal-200" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];
export const STAGE_VALUES = STAGES.map((s) => s.value) as [Stage, ...Stage[]];

const byValue = new Map(STAGES.map((s) => [s.value, s]));

export function stageLabel(stage: string): string {
  return byValue.get(stage as Stage)?.label ?? stage;
}

export function stageTone(stage: string): string {
  return byValue.get(stage as Stage)?.tone ?? "bg-muted text-foreground border-border";
}

export function isClosedStage(stage: string): boolean {
  return byValue.get(stage as Stage)?.group === "closed";
}

/** Mirrors private.stage_requires_reason() in the database. */
export function stageRequiresReason(stage: string): boolean {
  return stage === "rejected" || stage === "withdrawn" || stage === "on_hold" || stage === "future_opportunity";
}

/** Submitted to Client goes through the consent-recording submit flow, never a plain move. */
export const SUBMIT_STAGE: Stage = "submitted_to_client";

export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

/** Default name shown to employers: first name + last initial ("Jordan R."). */
export function defaultDisplayName(first: string, last: string): string {
  const initial = last.trim().replace(/[^A-Za-z]/g, "").charAt(0);
  return initial ? `${first.trim()} ${initial.toUpperCase()}.` : first.trim();
}
