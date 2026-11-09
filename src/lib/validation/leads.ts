import { z } from "zod";

import { SPECIALTY_VALUES } from "@/content/specialties";
import { emailSchema } from "@/lib/validation/auth";

export const CONTACT_TOPICS = [
  { value: "general", label: "General question" },
  { value: "hiring", label: "I'm hiring" },
  { value: "job_search", label: "I'm looking for a job" },
  { value: "partnership", label: "Partnership or vendor inquiry" },
  { value: "other", label: "Something else" },
] as const;

export const HIRING_TIMELINES = [
  { value: "immediately", label: "As soon as possible" },
  { value: "1-3-months", label: "Within 1–3 months" },
  { value: "3-plus-months", label: "In 3 or more months" },
  { value: "exploring", label: "Just exploring" },
] as const;

const values = <T extends readonly { value: string }[]>(items: T) =>
  items.map((i) => i.value) as [T[number]["value"], ...T[number]["value"][]];

/** Blank form fields become undefined; non-blank values are trimmed and length-checked. */
const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v),
    z.string().max(max, `${label} must be ${max} characters or fewer.`).optional(),
  );

const requiredText = (max: number, message: string, label: string) =>
  z
    .string({ error: message })
    .trim()
    .min(1, message)
    .max(max, `${label} must be ${max} characters or fewer.`);

const phoneSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v),
  z
    .string()
    .regex(/^[+()\d\s.\-x]{7,40}$/i, "Enter a valid phone number.")
    .refine((v) => (v.match(/\d/g) ?? []).length >= 7, "Enter a valid phone number.")
    .optional(),
);

const baseLead = {
  fullName: requiredText(200, "Enter your name.", "Name"),
  email: emailSchema,
  phone: phoneSchema,
  consent: z.literal("on", { error: "Please agree to the privacy policy so we can respond." }),
  // Honeypot: hidden from people, often filled in by bots. Must be empty.
  website: z.string().max(0).optional().or(z.literal("")),
  sourcePath: optionalText(300, "Source").refine((v) => v === undefined || v.startsWith("/"), "Invalid source."),
};

export const contactLeadSchema = z.object({
  ...baseLead,
  type: z.literal("contact"),
  topic: z.enum(values(CONTACT_TOPICS), { error: "Choose a topic." }),
  message: requiredText(5000, "Enter a message.", "Message").refine((v) => v.length >= 10, {
    message: "Please add a bit more detail (at least 10 characters).",
  }),
});

export const employerLeadSchema = z.object({
  ...baseLead,
  type: z.literal("employer"),
  companyName: requiredText(200, "Enter your company name.", "Company name"),
  contactTitle: optionalText(200, "Your title"),
  roleTitle: requiredText(200, "Enter the role you're hiring for.", "Role"),
  location: optionalText(200, "Location"),
  positionsCount: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce
      .number({ error: "Enter a number." })
      .int("Enter a whole number.")
      .min(1, "Enter at least 1.")
      .max(100, "Enter 100 or fewer.")
      .optional(),
  ),
  timeline: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(values(HIRING_TIMELINES), { error: "Choose a timeline." }).optional(),
  ),
  message: optionalText(5000, "Message"),
});

export const candidateLeadSchema = z.object({
  ...baseLead,
  type: z.literal("candidate"),
  specialty: z.enum(SPECIALTY_VALUES, { error: "Choose an area." }),
  contactTitle: optionalText(200, "Current title"),
  location: optionalText(200, "Location"),
  jobId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  message: optionalText(5000, "Message"),
});

export const leadSchema = z.discriminatedUnion("type", [contactLeadSchema, employerLeadSchema, candidateLeadSchema]);

export type LeadInput = z.infer<typeof leadSchema>;
export type LeadType = LeadInput["type"];

/** Maps validated input to `public.leads` columns. */
export function toLeadRow(input: LeadInput) {
  return {
    type: input.type,
    full_name: input.fullName,
    email: input.email,
    phone: input.phone ?? null,
    topic: input.type === "contact" ? input.topic : null,
    company_name: input.type === "employer" ? input.companyName : null,
    contact_title: input.type === "contact" ? null : (input.contactTitle ?? null),
    role_title: input.type === "employer" ? input.roleTitle : null,
    location: input.type === "contact" ? null : (input.location ?? null),
    positions_count: input.type === "employer" ? (input.positionsCount ?? null) : null,
    timeline: input.type === "employer" ? (input.timeline ?? null) : null,
    specialty: input.type === "candidate" ? input.specialty : null,
    job_id: input.type === "candidate" ? (input.jobId ?? null) : null,
    message: input.message ?? null,
    source_path: input.sourcePath ?? null,
  };
}
