import { z } from "zod";

import { emailSchema } from "@/lib/validation/auth";

/** Blank strings become undefined; others are trimmed. */
const blankToUndefined = (v: unknown) =>
  typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v;

const optionalText = (max: number, label: string) =>
  z.preprocess(blankToUndefined, z.string().max(max, `${label} must be ${max} characters or fewer.`).optional());

const requiredText = (max: number, message: string, label: string) =>
  z.string({ error: message }).trim().min(1, message).max(max, `${label} must be ${max} characters or fewer.`);

const optionalEmail = z.preprocess(blankToUndefined, emailSchema.optional());

const optionalPhone = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^[+()\d\s.\-x]{7,40}$/i, "Enter a valid phone number.")
    .refine((v) => (v.match(/\d/g) ?? []).length >= 7, "Enter a valid phone number.")
    .optional(),
);

export const TAG_PATTERN = /^[a-z0-9][a-z0-9 +#./-]{0,39}$/;
export const MAX_TAGS = 20;

/** "CCNP, Open to relocation, ccnp" → ["ccnp", "open to relocation"]. Mirrors private.valid_tags(). */
export function parseTags(input: string): { tags: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag) continue;
    if (!TAG_PATTERN.test(tag)) invalid.push(raw.trim());
    else seen.add(tag);
  }
  return { tags: [...seen], invalid };
}

const tagsSchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const { tags, invalid } = parseTags(v ?? "");
    if (invalid.length) {
      ctx.addIssue({
        code: "custom",
        message: `Tags may use letters, numbers, spaces and + # . / - (max 40 characters): ${invalid.slice(0, 3).join(", ")}`,
      });
      return z.NEVER;
    }
    if (tags.length > MAX_TAGS) {
      ctx.addIssue({ code: "custom", message: `Use at most ${MAX_TAGS} tags.` });
      return z.NEVER;
    }
    return tags;
  });

export const candidateFormSchema = z.object({
  firstName: requiredText(100, "Enter a first name.", "First name"),
  lastName: requiredText(100, "Enter a last name.", "Last name"),
  email: optionalEmail,
  phone: optionalPhone,
  location: optionalText(200, "Location"),
  headline: optionalText(200, "Headline"),
  summary: optionalText(5000, "Summary"),
  source: optionalText(100, "Source"),
  ownerId: z.preprocess(blankToUndefined, z.uuid("Choose a valid owner.").optional()),
  tags: tagsSchema,
});

export type CandidateFormInput = z.infer<typeof candidateFormSchema>;

export function toCandidateColumns(input: CandidateFormInput) {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    location: input.location ?? null,
    headline: input.headline ?? null,
    summary: input.summary ?? null,
    source: input.source ?? null,
    owner_id: input.ownerId ?? null,
    tags: input.tags,
  };
}

// --- Profile sections -------------------------------------------------------

const isoDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date.")
    .optional(),
);

/** <input type="month"> value (YYYY-MM) → first day of the month. */
const monthDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter a valid month.")
    .transform((v) => `${v}-01`)
    .optional(),
);

export const skillSchema = z.object({
  name: requiredText(80, "Enter a skill.", "Skill"),
  yearsExperience: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "Enter a number of years." })
      .min(0, "Years can't be negative.")
      .max(60, "Enter 60 or fewer years.")
      .refine((v) => Number.isInteger(v * 2), "Use whole or half years.")
      .optional(),
  ),
});

export const certificationSchema = z
  .object({
    name: requiredText(200, "Enter the certification name.", "Certification"),
    issuer: optionalText(200, "Issuer"),
    credentialId: optionalText(100, "Credential ID"),
    issuedOn: isoDate,
    expiresOn: isoDate,
  })
  .refine((v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn, {
    path: ["expiresOn"],
    message: "Expiry can't be before the issue date.",
  });

export const workHistorySchema = z
  .object({
    companyName: requiredText(200, "Enter the company.", "Company"),
    title: requiredText(200, "Enter the job title.", "Title"),
    location: optionalText(200, "Location"),
    startDate: monthDate,
    endDate: monthDate,
    isCurrent: z.preprocess((v) => v === "on", z.boolean()),
    description: optionalText(5000, "Description"),
  })
  .refine((v) => !(v.isCurrent && v.endDate), { path: ["endDate"], message: "Leave the end date empty for a current role." })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "End date can't be before the start date.",
  });

export const noteSchema = z.object({
  body: z
    .string({ error: "Write a note." })
    .trim()
    .min(1, "Write a note.")
    .max(10000, "Notes must be 10,000 characters or fewer."),
});

export const idSchema = z.uuid();
