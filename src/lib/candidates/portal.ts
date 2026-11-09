import { z } from "zod";

import { candidateFormSchema } from "@/lib/candidates/validation";

/** Fields a candidate may edit on their own record (mirrors public.update_my_candidate_profile). */
export const myProfileSchema = candidateFormSchema.pick({
  firstName: true,
  lastName: true,
  phone: true,
  location: true,
  headline: true,
  summary: true,
});

export const WORK_ARRANGEMENTS = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const;

const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v),
    z.string().max(max, `${label} must be ${max} characters or fewer.`).optional(),
  );

const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

export const preferencesSchema = z.object({
  openToOpportunities: checkbox,
  desiredTitles: optionalText(300, "Desired roles"),
  preferredLocations: optionalText(300, "Preferred locations"),
  workArrangement: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["onsite", "hybrid", "remote"], { error: "Choose a work arrangement." }).optional(),
  ),
  willingToRelocate: checkbox,
  emailJobAlerts: checkbox,
  emailApplicationUpdates: checkbox,
  phoneContactOk: checkbox,
});

export const PRIVACY_REQUEST_KINDS = [
  { value: "access", label: "Send me a copy of my data", short: "Copy of my data" },
  { value: "correction", label: "Correct information about me", short: "Correction" },
  { value: "deletion", label: "Delete my account and data", short: "Deletion" },
  { value: "stop_contact", label: "Stop contacting me", short: "Stop contact" },
] as const;

export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number]["value"];

export const PRIVACY_STATUS_LABELS: Record<string, string> = {
  open: "Received",
  in_progress: "In progress",
  completed: "Completed",
  declined: "Declined",
};

export function privacyKindLabel(kind: string): string {
  return PRIVACY_REQUEST_KINDS.find((k) => k.value === kind)?.short ?? kind;
}

export const privacyRequestSchema = z.object({
  kind: z.enum(["access", "correction", "deletion", "stop_contact"], { error: "Choose what you'd like us to do." }),
  details: optionalText(2000, "Details"),
});

export const resolvePrivacySchema = z
  .object({
    requestId: z.uuid("Unknown request."),
    status: z.enum(["in_progress", "completed", "declined"], { error: "Choose a status." }),
    note: optionalText(2000, "Note"),
  })
  .refine((v) => v.status !== "declined" || Boolean(v.note), {
    path: ["note"],
    message: "Explain why the request is declined.",
  });

/** Share of the profile a candidate has filled in, for the overview checklist. */
export function profileChecklist(input: {
  hasName: boolean;
  phone: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  resumeCount: number;
  hasPreferences: boolean;
}) {
  return [
    { label: "Your name", done: input.hasName },
    { label: "Phone number", done: Boolean(input.phone) },
    { label: "Location", done: Boolean(input.location) },
    { label: "Headline", done: Boolean(input.headline) },
    { label: "Summary", done: Boolean(input.summary) },
    { label: "Resume", done: input.resumeCount > 0 },
    { label: "Job preferences", done: input.hasPreferences },
  ];
}
