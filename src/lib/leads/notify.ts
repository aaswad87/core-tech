/**
 * Email alert for a new website lead, sent to the business inbox (Zoho) through Resend. Pure so it can be
 * unit-tested. Everything the visitor typed is untrusted: it is HTML-escaped, and header-bound values
 * (subject, reply-to) are reduced to one line. The full record stays in /admin/leads.
 */
import { siteConfig } from "@/config/site";
import { escapeHtml } from "@/lib/market/notify";
import { CONTACT_TOPICS, HIRING_TIMELINES } from "@/lib/validation/leads";

export type LeadForEmail = {
  type: "contact" | "employer" | "candidate";
  full_name: string;
  email: string;
  phone: string | null;
  topic: string | null;
  company_name: string | null;
  contact_title: string | null;
  role_title: string | null;
  location: string | null;
  positions_count: number | null;
  timeline: string | null;
  specialty: string | null;
  message: string | null;
  source_path: string | null;
};

const TYPE_LABEL = { contact: "Contact message", employer: "Hiring request", candidate: "Candidate inquiry" } as const;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const labelOf = (list: readonly { value: string; label: string }[], v: string | null) => (v ? (list.find((o) => o.value === v)?.label ?? v) : null);

/** Hiring requests go to sales@; everything else to info@. */
export function leadRecipient(type: LeadForEmail["type"]): string {
  return type === "employer" ? siteConfig.email.sales : siteConfig.email.info;
}

/** Reply-To is the visitor's address only when it is a single plain address (the schema already validated it). */
export function safeReplyTo(email: string): string | null {
  return /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(email) ? email : null;
}

export function renderLeadEmail(lead: LeadForEmail, appUrl: string): { subject: string; html: string; text: string } {
  const who = oneLine(lead.full_name).slice(0, 80);
  const about = lead.type === "employer" ? oneLine(lead.role_title ?? "") : lead.type === "contact" ? labelOf(CONTACT_TOPICS, lead.topic) : lead.specialty;
  const subject = `${TYPE_LABEL[lead.type]}: ${who}${about ? ` — ${oneLine(about).slice(0, 80)}` : ""}`.slice(0, 200);

  const rows: [string, string][] = (
    [
      ["Name", lead.full_name],
      ["Email", lead.email],
      ["Phone", lead.phone],
      ["Topic", labelOf(CONTACT_TOPICS, lead.topic)],
      ["Company", lead.company_name],
      ["Title", lead.contact_title],
      ["Role to fill", lead.role_title],
      ["Positions", lead.positions_count === null ? null : String(lead.positions_count)],
      ["Timeline", labelOf(HIRING_TIMELINES, lead.timeline)],
      ["Area", lead.specialty],
      ["Location", lead.location],
      ["Sent from page", lead.source_path],
    ] as [string, string | null][]
  ).filter((r): r is [string, string] => Boolean(r[1]));

  const inbox = `${appUrl}/admin/leads`;
  const rowHtml = rows
    .map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font-size:14px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:14px">${escapeHtml(v)}</td></tr>`)
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f5f8f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;padding:28px">
      <tr><td>
        <div style="font-size:13px;font-weight:700;letter-spacing:.06em;color:#047857;text-transform:uppercase">New website ${escapeHtml(TYPE_LABEL[lead.type].toLowerCase())}</div>
        <h1 style="font-size:20px;margin:8px 0 16px">${escapeHtml(subject)}</h1>
        <table role="presentation" cellpadding="0" cellspacing="0">${rowHtml}</table>
        ${lead.message ? `<p style="font-size:14px;margin:16px 0 0;white-space:pre-line;border-left:3px solid #10b981;padding-left:12px">${escapeHtml(lead.message)}</p>` : ""}
      </td></tr>
      <tr><td style="padding-top:20px">
        <a href="${escapeHtml(inbox)}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Open the Leads inbox</a>
      </td></tr>
      <tr><td style="padding-top:20px;color:#6b7280;font-size:12px">Reply to this email to answer ${escapeHtml(who)} directly. Sent by the CoreTech website.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `New website ${TYPE_LABEL[lead.type].toLowerCase()}`,
    subject,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(lead.message ? ["", "Message:", lead.message] : []),
    "",
    `Leads inbox: ${inbox}`,
    "Reply to this email to answer them directly.",
  ].join("\n");

  return { subject, html, text };
}
