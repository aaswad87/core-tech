/**
 * Transactional interview emails (scheduled, rescheduled, cancelled) and their calendar invites.
 * Pure functions so they can be previewed in the UI and unit-tested. Every value is escaped for HTML;
 * the plain-text part carries the same content.
 */
import { escapeHtml } from "@/lib/market/notify";

export type InterviewEmailKind = "scheduled" | "rescheduled" | "cancelled";

export type InterviewEmailData = {
  interviewId: string;
  candidateFirstName: string;
  jobTitle: string;
  companyName: string | null;
  format: "video" | "phone" | "onsite";
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  meetingUrl: string | null;
  location: string | null;
  instructions: string | null;
  /** For rescheduled emails: the previous start time. */
  previousStartsAt?: string | null;
  /** For cancelled emails. */
  reason?: string | null;
  portalUrl: string;
  /** Bumped on every change so calendar apps replace the earlier invite. */
  sequence: number;
};

const FORMAT_LABEL = { video: "Video call", phone: "Phone call", onsite: "On-site" } as const;

export function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function subjectFor(kind: InterviewEmailKind, d: InterviewEmailData): string {
  const role = oneLine(d.jobTitle);
  const subject =
    kind === "scheduled"
      ? `Interview scheduled: ${role}`
      : kind === "rescheduled"
        ? `Interview time changed: ${role}`
        : `Interview cancelled: ${role}`;
  return subject.slice(0, 200);
}

function detailRows(d: InterviewEmailData): [string, string][] {
  const rows: [string, string][] = [
    ["When", `${formatWhen(d.startsAt, d.timezone)} (${d.durationMinutes} minutes)`],
    ["Format", FORMAT_LABEL[d.format]],
  ];
  if (d.companyName) rows.push(["With", d.companyName]);
  if (d.meetingUrl) rows.push(["Join link", d.meetingUrl]);
  if (d.location) rows.push(["Address", d.location]);
  return rows;
}

export function renderInterviewEmail(kind: InterviewEmailKind, d: InterviewEmailData): { subject: string; html: string; text: string } {
  const subject = subjectFor(kind, d);
  const greeting = `Hi ${d.candidateFirstName || "there"},`;
  const intro =
    kind === "scheduled"
      ? `Your interview for ${d.jobTitle} is confirmed.`
      : kind === "rescheduled"
        ? `The time of your interview for ${d.jobTitle} has changed.`
        : `Your interview for ${d.jobTitle} has been cancelled. Your recruiter will be in touch about next steps.`;

  const rows = kind === "cancelled" ? [["Was scheduled for", formatWhen(d.startsAt, d.timezone)] as [string, string]] : detailRows(d);
  if (kind === "rescheduled" && d.previousStartsAt) rows.push(["Previously", formatWhen(d.previousStartsAt, d.timezone)]);
  if (kind === "cancelled" && d.reason) rows.push(["Reason", d.reason]);

  const rowHtml = rows
    .map(([label, value]) => {
      const shown = label === "Join link" ? `<a href="${escapeHtml(value)}" style="color:#5b21b6">${escapeHtml(value)}</a>` : escapeHtml(value);
      return `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font-size:14px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px">${shown}</td></tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f8f7fc;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;padding:28px">
      <tr><td>
        <div style="font-size:13px;font-weight:700;letter-spacing:.06em;color:#6d28d9;text-transform:uppercase">CoreTech Recruiting</div>
        <h1 style="font-size:22px;margin:8px 0 12px">${escapeHtml(subject)}</h1>
        <p style="font-size:15px;margin:0 0 8px">${escapeHtml(greeting)}</p>
        <p style="font-size:15px;margin:0 0 16px">${escapeHtml(intro)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0">${rowHtml}</table>
        ${kind !== "cancelled" && d.instructions ? `<p style="font-size:14px;margin:16px 0 0;white-space:pre-line">${escapeHtml(d.instructions)}</p>` : ""}
      </td></tr>
      <tr><td style="padding-top:20px">
        <a href="${escapeHtml(d.portalUrl)}" style="display:inline-block;background:#6d28d9;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">View in your portal</a>
      </td></tr>
      <tr><td style="padding-top:20px;color:#6b7280;font-size:12px">You're receiving this because you have an application with CoreTech Recruiting. You can turn off application emails under Preferences in your portal.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    "CoreTech Recruiting",
    subject,
    "",
    greeting,
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(kind !== "cancelled" && d.instructions ? ["", d.instructions] : []),
    "",
    `View in your portal: ${d.portalUrl}`,
    "",
    "You can turn off application emails under Preferences in your portal.",
  ].join("\n");

  return { subject, html, text };
}

// --- Calendar invite (RFC 5545) ---------------------------------------------

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapes TEXT values and folds lines to 75 octets (approximated by characters). */
function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
  return out.join("\r\n");
}

export function buildInterviewIcs(kind: InterviewEmailKind, d: InterviewEmailData, now: Date = new Date()): string {
  const end = new Date(new Date(d.startsAt).getTime() + d.durationMinutes * 60_000).toISOString();
  const title = `Interview: ${oneLine(d.jobTitle)}${d.companyName ? ` (${oneLine(d.companyName)})` : ""}`;
  const description = [d.meetingUrl && `Join: ${d.meetingUrl}`, d.instructions, `Details: ${d.portalUrl}`].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CoreTech Recruiting//Interviews//EN",
    `METHOD:${kind === "cancelled" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:interview-${d.interviewId}@coretech-recruiting`,
    `SEQUENCE:${d.sequence}`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(d.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(d.location ? [`LOCATION:${icsText(d.location)}`] : d.meetingUrl ? [`LOCATION:${icsText(d.meetingUrl)}`] : []),
    `STATUS:${kind === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
