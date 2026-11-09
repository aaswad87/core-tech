import { z } from "zod";

import { emailSchema } from "@/lib/validation/auth";

const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v);
const optionalText = (max: number, label: string) =>
  z.preprocess(blank, z.string().max(max, `${label} must be ${max} characters or fewer.`).optional());
const requiredText = (min: number, max: number, message: string, label: string) =>
  z.string({ error: message }).trim().min(min, message).max(max, `${label} must be ${max} characters or fewer.`);
const money = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.replace(/[$,\s]/g, "")) : v),
  z.coerce.number({ error: "Enter a number." }).min(0, "Can't be negative.").max(9_999_999, "Too large.").optional(),
);
const id = z.uuid("Unknown record.");

// --- Labels -----------------------------------------------------------------

/** What the employer sees for each submission status. */
export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  submitted: "New",
  under_review: "Under review",
  interview_requested: "Interview requested",
  declined: "Not moving forward",
  withdrawn: "Withdrawn",
  hired: "Hired",
};

export const OPEN_SUBMISSION_STATUSES = ["submitted", "under_review", "interview_requested"];

export const JOB_REQUEST_STATUS_LABELS: Record<string, string> = {
  submitted: "Sent to CoreTech",
  in_review: "In review",
  converted: "Job opened",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  requested: "Waiting for CoreTech",
  scheduled: "Scheduled",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const INTERVIEW_FORMATS = [
  { value: "video", label: "Video call" },
  { value: "phone", label: "Phone" },
  { value: "onsite", label: "On-site" },
] as const;

export const INTERVIEW_DURATIONS = [
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "Half day" },
] as const;

export const US_TIMEZONES = [
  { value: "America/Chicago", label: "Central (Texas)" },
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
] as const;

export const MEMBER_ROLES = [
  { value: "member", label: "Member" },
  { value: "owner", label: "Owner" },
] as const;

// --- Wall-clock times -------------------------------------------------------

/** Offset (minutes) of `timeZone` from UTC at the given instant. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Converts a `<input type="datetime-local">` value ("2026-11-20T14:30"), read as wall-clock time in
 * `timeZone`, to a UTC ISO string. Returns null for malformed input.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  // Two passes settle the offset across DST boundaries.
  let utc = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  utc = guess - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000;
  return new Date(utc).toISOString();
}

export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone, timeZoneName: "short" }).format(new Date(iso));
}

// --- Schemas ----------------------------------------------------------------

export const companyProfileSchema = z.object({
  companyId: id,
  website: z.preprocess(blank, z.url({ protocol: /^https?$/, error: "Enter a full web address starting with https://" }).max(300).optional()),
  industry: optionalText(120, "Industry"),
  headquarters: optionalText(200, "Headquarters"),
  about: optionalText(2000, "About"),
});

export const memberRequestSchema = z.object({
  companyId: id,
  fullName: requiredText(1, 200, "Enter their name.", "Name"),
  email: emailSchema,
  memberRole: z.enum(["member", "owner"], { error: "Choose a role." }),
});

export const memberRoleSchema = z.object({
  companyId: id,
  userId: id,
  memberRole: z.enum(["member", "owner"], { error: "Choose a role." }),
});

export const jobRequestSchema = z
  .object({
    companyId: id,
    title: requiredText(2, 200, "Enter a job title.", "Title"),
    location: optionalText(200, "Location"),
    workArrangement: z.preprocess(blank, z.enum(["onsite", "hybrid", "remote"]).optional()),
    employmentType: z.enum(["direct_hire", "contract", "contract_to_hire"], { error: "Choose an employment type." }),
    openings: z.coerce.number({ error: "Enter a number." }).int("Use a whole number.").min(1, "At least 1.").max(100, "At most 100."),
    salaryMin: money,
    salaryMax: money,
    targetStart: z.preprocess(blank, z.iso.date({ error: "Enter a valid date." }).optional()),
    description: requiredText(1, 10000, "Describe the role.", "Description"),
    mustHaveSkills: optionalText(1000, "Must-have skills"),
  })
  .refine((v) => v.salaryMin === undefined || v.salaryMax === undefined || v.salaryMin <= v.salaryMax, {
    path: ["salaryMax"],
    message: "Maximum must be at least the minimum.",
  });

export const submissionResponseSchema = z.object({
  submissionId: id,
  status: z.enum(["under_review", "declined"], { error: "Choose a response." }),
});

export const feedbackSchema = z.object({
  submissionId: id,
  rating: z.preprocess(blank, z.coerce.number().int().min(1, "Choose 1–5.").max(5, "Choose 1–5.").optional()),
  body: requiredText(1, 5000, "Write your feedback.", "Feedback"),
});

export const interviewRequestSchema = z
  .object({
    submissionId: id,
    format: z.enum(["video", "phone", "onsite"], { error: "Choose a format." }),
    durationMinutes: z.coerce.number({ error: "Choose a length." }).int().min(15).max(480),
    timezone: z.enum(US_TIMEZONES.map((t) => t.value) as [string, ...string[]], { error: "Choose a time zone." }),
    slot1: z.string().trim().min(1, "Propose at least one time."),
    slot2: z.string().trim().optional(),
    slot3: z.string().trim().optional(),
    interviewers: optionalText(500, "Interviewers"),
    notes: optionalText(2000, "Notes"),
  })
  .transform((v, ctx) => {
    const times: string[] = [];
    for (const key of ["slot1", "slot2", "slot3"] as const) {
      const raw = v[key];
      if (!raw) continue;
      const iso = zonedLocalToIso(raw, v.timezone);
      if (!iso) {
        ctx.addIssue({ code: "custom", path: [key], message: "Enter a valid date and time." });
        return z.NEVER;
      }
      if (new Date(iso).getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", path: [key], message: "Choose a time in the future." });
        return z.NEVER;
      }
      times.push(iso);
    }
    return { ...v, proposedTimes: times };
  });

// Staff-side

export const reviewJobRequestSchema = z
  .object({
    requestId: id,
    status: z.enum(["in_review", "declined"], { error: "Choose a status." }),
    note: optionalText(2000, "Note"),
  })
  .refine((v) => v.status !== "declined" || Boolean(v.note), { path: ["note"], message: "Tell the employer why." });

export const handleInterviewSchema = z
  .object({
    requestId: id,
    status: z.enum(["scheduled", "declined"], { error: "Choose a status." }),
    confirmedTime: z.string().trim().optional(),
    note: optionalText(2000, "Note"),
  })
  .refine((v) => v.status !== "scheduled" || Boolean(v.confirmedTime), { path: ["confirmedTime"], message: "Choose the confirmed time." })
  .refine((v) => v.status !== "declined" || Boolean(v.note), { path: ["note"], message: "Tell the employer why." });
