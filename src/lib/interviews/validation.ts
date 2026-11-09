import { z } from "zod";

import { US_TIMEZONES, zonedLocalToIso } from "@/lib/employer/validation";

export const INTERVIEW_KINDS = [
  { value: "recruiter_screen", label: "Recruiter screen" },
  { value: "technical", label: "Technical evaluation" },
  { value: "client", label: "Client interview" },
  { value: "final", label: "Final interview" },
  { value: "other", label: "Other" },
] as const;

export const INTERVIEW_STATUS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
] as const;

export const INTERVIEW_OUTCOMES = [
  { value: "advance", label: "Advance" },
  { value: "hold", label: "Hold" },
  { value: "decline", label: "Not moving forward" },
] as const;

export const RECOMMENDATIONS = [
  { value: "strong_yes", label: "Strong yes" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "strong_no", label: "Strong no" },
] as const;

export const labelOf = (list: readonly { value: string; label: string }[], value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? value ?? "";

const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v);
const optionalText = (max: number, label: string) =>
  z.preprocess(blank, z.string().max(max, `${label} must be ${max} characters or fewer.`).optional());
const requiredText = (max: number, message: string) => z.string({ error: message }).trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
const httpsUrl = z.preprocess(
  blank,
  z.url({ protocol: /^https$/, error: "Use a full https:// meeting link." }).max(500, "Link is too long.").optional(),
);
const timezone = z.enum(US_TIMEZONES.map((t) => t.value) as [string, ...string[]], { error: "Choose a time zone." });
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

/** A datetime-local value read in the chosen zone, which must be in the future. */
function futureInstant<T extends { startsAtLocal: string; timezone: string }>(v: T, ctx: z.RefinementCtx) {
  const iso = zonedLocalToIso(v.startsAtLocal, v.timezone);
  if (!iso) {
    ctx.addIssue({ code: "custom", path: ["startsAtLocal"], message: "Enter a valid date and time." });
    return z.NEVER;
  }
  if (new Date(iso).getTime() <= Date.now()) {
    ctx.addIssue({ code: "custom", path: ["startsAtLocal"], message: "Choose a time in the future." });
    return z.NEVER;
  }
  return iso;
}

function placeRules(v: { format: string; meetingUrl?: string; location?: string }, ctx: z.RefinementCtx) {
  if (v.format === "video" && !v.meetingUrl) ctx.addIssue({ code: "custom", path: ["meetingUrl"], message: "Add the meeting link." });
  if (v.format === "onsite" && !v.location) ctx.addIssue({ code: "custom", path: ["location"], message: "Add the address." });
}

export const scheduleSchema = z
  .object({
    applicationId: z.uuid("Unknown application."),
    interviewRequestId: z.preprocess(blank, z.uuid().optional()),
    kind: z.enum(["recruiter_screen", "technical", "client", "final", "other"], { error: "Choose the interview type." }),
    format: z.enum(["video", "phone", "onsite"], { error: "Choose a format." }),
    startsAtLocal: z.string().trim().min(1, "Choose the date and time."),
    durationMinutes: z.coerce.number({ error: "Choose a length." }).int().min(15).max(480),
    timezone,
    meetingUrl: httpsUrl,
    location: optionalText(300, "Address"),
    interviewers: optionalText(500, "Interviewers"),
    instructions: optionalText(2000, "Instructions"),
    notifyCandidate: checkbox,
  })
  .superRefine(placeRules)
  .transform((v, ctx) => ({ ...v, startsAt: futureInstant(v, ctx) }));

export const rescheduleSchema = z
  .object({
    interviewId: z.uuid("Unknown interview."),
    format: z.enum(["video", "phone", "onsite"]),
    startsAtLocal: z.string().trim().min(1, "Choose the new date and time."),
    durationMinutes: z.coerce.number({ error: "Choose a length." }).int().min(15).max(480),
    timezone,
    meetingUrl: httpsUrl,
    location: optionalText(300, "Address"),
    reason: requiredText(1000, "Give a reason for the change."),
    notifyCandidate: checkbox,
  })
  .superRefine(placeRules)
  .transform((v, ctx) => ({ ...v, startsAt: futureInstant(v, ctx) }));

export const cancelSchema = z.object({
  interviewId: z.uuid("Unknown interview."),
  reason: requiredText(1000, "Give a reason for cancelling."),
  notifyCandidate: checkbox,
});

export const outcomeSchema = z
  .object({
    interviewId: z.uuid("Unknown interview."),
    status: z.enum(["completed", "no_show"], { error: "Choose what happened." }),
    outcome: z.preprocess(blank, z.enum(["advance", "hold", "decline"]).optional()),
    summary: optionalText(2000, "Summary"),
  })
  .refine((v) => v.status !== "no_show" || !v.outcome, { path: ["outcome"], message: "A no-show has no outcome." });

export const interviewFeedbackSchema = z.object({
  interviewId: z.uuid("Unknown interview."),
  rating: z.preprocess(blank, z.coerce.number().int().min(1).max(5).optional()),
  recommendation: z.preprocess(blank, z.enum(["strong_yes", "yes", "no", "strong_no"]).optional()),
  body: requiredText(5000, "Write your feedback."),
});

/** True once `iso` is at or before now (shifted by an optional grace period in minutes). */
export function hasStarted(iso: string, graceMinutes = 0, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime() + graceMinutes * 60_000;
}

/** "2026-11-20T09:30" in `timeZone` for prefilling a datetime-local input. */
export function toZonedLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
