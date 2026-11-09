import { z } from "zod";

import { parseTerms } from "@/lib/market/validation";

export const JOB_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending approval" },
  { value: "published", label: "Published" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
] as const;

export const EMPLOYMENT_TYPES = [
  { value: "direct_hire", label: "Direct hire" },
  { value: "contract", label: "Contract" },
  { value: "contract_to_hire", label: "Contract-to-hire" },
] as const;

export const WORK_ARRANGEMENT_OPTIONS = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const;

const values = <T extends readonly { value: string }[]>(items: T) => items.map((i) => i.value) as [T[number]["value"], ...T[number]["value"][]];

export const jobStatusSchema = z.enum(values(JOB_STATUSES));

const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v);
const optionalText = (max: number, label: string) =>
  z.preprocess(blank, z.string().max(max, `${label} must be ${max} characters or fewer.`).optional());
const money = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.replace(/[$,\s]/g, "")) : v),
  z.coerce.number({ error: "Enter a number." }).min(0, "Can't be negative.").max(9_999_999, "Too large.").optional(),
);

const skills = (label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const list = parseTerms(v ?? "");
      if (list.length > 30) ctx.addIssue({ code: "custom", message: `Use at most 30 ${label}.` });
      if (list.some((t) => t.length > 80)) ctx.addIssue({ code: "custom", message: "Keep each skill under 80 characters." });
      return list;
    });

export const jobFormSchema = z
  .object({
    title: z.string({ error: "Enter a job title." }).trim().min(2, "Enter a job title.").max(200, "Use 200 characters or fewer."),
    companyId: z.preprocess(blank, z.uuid("Choose a company.").optional()),
    newCompanyName: optionalText(200, "Company name"),
    status: jobStatusSchema,
    ownerId: z.preprocess(blank, z.uuid("Choose a valid owner.").optional()),
    location: optionalText(200, "Location"),
    workArrangement: z.preprocess(blank, z.enum(values(WORK_ARRANGEMENT_OPTIONS)).optional()),
    employmentType: z.enum(values(EMPLOYMENT_TYPES)),
    salaryMin: money,
    salaryMax: money,
    requiredSkills: skills("required skills"),
    preferredSkills: skills("preferred skills"),
    publicSummary: optionalText(2000, "Public summary"),
    publicDescription: optionalText(20000, "Public description"),
    description: optionalText(20000, "Internal notes"),
  })
  .superRefine((v, ctx) => {
    if (!v.companyId && !v.newCompanyName) {
      ctx.addIssue({ code: "custom", path: ["companyId"], message: "Choose a company or enter a new one." });
    }
    if (v.salaryMin !== undefined && v.salaryMax !== undefined && v.salaryMin > v.salaryMax) {
      ctx.addIssue({ code: "custom", path: ["salaryMax"], message: "Maximum must be at least the minimum." });
    }
    if (v.status === "published" && !v.publicSummary && !v.publicDescription) {
      ctx.addIssue({ code: "custom", path: ["publicSummary"], message: "Add a public summary before publishing." });
    }
  });

export type JobFormInput = z.infer<typeof jobFormSchema>;

export function toJobColumns(input: JobFormInput) {
  return {
    title: input.title,
    status: input.status,
    owner_id: input.ownerId ?? null,
    location: input.location ?? null,
    work_arrangement: input.workArrangement ?? null,
    employment_type: input.employmentType,
    salary_min: input.salaryMin ?? null,
    salary_max: input.salaryMax ?? null,
    required_skills: input.requiredSkills,
    preferred_skills: input.preferredSkills,
    public_summary: input.publicSummary ?? null,
    public_description: input.publicDescription ?? null,
    description: input.description ?? null,
  };
}

export function jobStatusLabel(status: string): string {
  return JOB_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export const JOB_STATUS_TONES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-800",
  pending: "bg-amber-100 text-amber-900",
  published: "bg-emerald-100 text-emerald-900",
  paused: "bg-stone-200 text-stone-800",
  closed: "bg-zinc-200 text-zinc-700",
  archived: "bg-zinc-100 text-zinc-500",
};
