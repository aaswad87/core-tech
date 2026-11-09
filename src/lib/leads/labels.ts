import { specialtyOptions } from "@/content/specialties";
import { CONTACT_TOPICS, HIRING_TIMELINES } from "@/lib/validation/leads";

/** Mirrors `public.lead_status`. */
export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "closed", label: "Closed" },
  { value: "spam", label: "Spam" },
] as const;

/** Mirrors `public.lead_type`. */
export const LEAD_TYPES = [
  { value: "contact", label: "Contact" },
  { value: "employer", label: "Hiring request" },
  { value: "candidate", label: "Candidate" },
] as const;

const lookup = (items: readonly { value: string; label: string }[]) => (value: string | null) =>
  value ? (items.find((i) => i.value === value)?.label ?? value) : null;

export const leadStatusLabel = lookup(LEAD_STATUSES);
export const leadTypeLabel = lookup(LEAD_TYPES);
export const topicLabel = lookup(CONTACT_TOPICS);
export const timelineLabel = lookup(HIRING_TIMELINES);
export const specialtyLabel = lookup(specialtyOptions);
