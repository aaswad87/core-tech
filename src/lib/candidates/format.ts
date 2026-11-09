import type { ActivityRow } from "@/lib/candidates/types";

const FIELD_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  email: "email",
  phone: "phone",
  location: "location",
  headline: "headline",
  summary: "summary",
  source: "source",
  owner_id: "owner",
  tags: "tags",
  user_id: "portal account",
  is_demo: "demo flag",
};

function str(details: Record<string, unknown>, key: string): string {
  const v = details[key];
  return typeof v === "string" ? v : "";
}

/** Human-readable description of an activity entry. Owner ids are resolved through `names`. */
export function describeActivity(entry: Pick<ActivityRow, "action" | "details">, names: Map<string, string>): string {
  const d = entry.details ?? {};
  switch (entry.action) {
    case "candidate.created":
      return "Created the candidate";
    case "candidate.updated": {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]).map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, " ")) : [];
      return fields.length ? `Updated ${fields.join(", ")}` : "Updated the candidate";
    }
    case "candidate.owner_changed": {
      const from = names.get(str(d, "from_owner")) ?? "no owner";
      const to = names.get(str(d, "to_owner")) ?? "no owner";
      return `Changed owner from ${from} to ${to}`;
    }
    case "skill.added":
      return `Added skill “${str(d, "name")}”`;
    case "skill.removed":
      return `Removed skill “${str(d, "name")}”`;
    case "skill.updated":
      return `Updated skill “${str(d, "name")}”`;
    case "certification.added":
      return `Added certification “${str(d, "name")}”`;
    case "certification.removed":
      return `Removed certification “${str(d, "name")}”`;
    case "certification.updated":
      return `Updated certification “${str(d, "name")}”`;
    case "work_history.added":
      return `Added work history: ${str(d, "title")} at ${str(d, "company")}`;
    case "work_history.removed":
      return `Removed work history: ${str(d, "title")} at ${str(d, "company")}`;
    case "work_history.updated":
      return `Updated work history: ${str(d, "title")} at ${str(d, "company")}`;
    case "note.added":
      return "Added an internal note";
    case "note.removed":
      return "Deleted an internal note";
    case "resume.added":
      return `Uploaded resume “${str(d, "file_name")}”`;
    case "resume.removed":
      return `Deleted resume “${str(d, "file_name")}”`;
    default:
      return entry.action;
  }
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

export const formatMonth = (iso: string | null) => (iso ? monthYear.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : null);
export const formatDate = (iso: string | null) => (iso ? fullDate.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : null);
export const formatDateTime = (iso: string) => `${dateTime.format(new Date(iso))} CT`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fullName(c: { first_name: string; last_name: string }): string {
  return `${c.first_name} ${c.last_name}`;
}

/** "YYYY-MM-DD" → "YYYY-MM" for <input type="month">. */
export const toMonthInput = (iso: string | null) => (iso ? iso.slice(0, 7) : "");
