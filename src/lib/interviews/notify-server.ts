import "server-only";

import { siteConfig } from "@/config/site";
import { getMarketConfig } from "@/lib/env.server";
import { buildInterviewIcs, type InterviewEmailData, type InterviewEmailKind, renderInterviewEmail } from "@/lib/interviews/email";
import { sendEmail } from "@/lib/market/notify";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type EmailOutcome = { status: "sent" | "failed" | "skipped"; message: string };

/** Email sending needs RESEND_API_KEY and a From address on a domain verified in Resend. */
export function isEmailConfigured(): boolean {
  try {
    return getMarketConfig().email !== null;
  } catch {
    return false;
  }
}

/** Loads everything an interview email needs, read as the signed-in staff user (RLS applies). */
export async function loadInterviewEmailData(
  supabase: Supabase,
  interviewId: string,
  extra: { previousStartsAt?: string | null; reason?: string | null } = {},
): Promise<{ data: InterviewEmailData; to: string | null; optedOut: boolean } | null> {
  const { data: i } = await supabase
    .from("interviews")
    .select("id, candidate_id, kind, format, starts_at, duration_minutes, timezone, meeting_url, location, instructions, jobs(title), companies(name), candidates(first_name, email)")
    .eq("id", interviewId)
    .maybeSingle();
  if (!i) return null;

  const [{ data: prefs }, { count }] = await Promise.all([
    supabase.from("candidate_preferences").select("email_application_updates").eq("candidate_id", i.candidate_id).maybeSingle(),
    supabase.from("interview_events").select("id", { count: "exact", head: true }).eq("interview_id", interviewId),
  ]);

  const candidate = i.candidates as unknown as { first_name: string; email: string | null } | null;
  const job = i.jobs as unknown as { title: string } | null;
  const company = i.companies as unknown as { name: string } | null;
  const showCompany = i.kind === "client" || i.kind === "final";

  return {
    to: candidate?.email ?? null,
    // No saved preference means the default (application emails on).
    optedOut: prefs ? prefs.email_application_updates === false : false,
    data: {
      interviewId,
      candidateFirstName: candidate?.first_name === "Candidate" ? "" : (candidate?.first_name ?? ""),
      jobTitle: job?.title ?? "your application",
      companyName: showCompany ? (company?.name ?? null) : null,
      format: i.format as InterviewEmailData["format"],
      startsAt: i.starts_at as string,
      durationMinutes: i.duration_minutes as number,
      timezone: i.timezone as string,
      meetingUrl: i.meeting_url as string | null,
      location: i.location as string | null,
      instructions: i.instructions as string | null,
      previousStartsAt: extra.previousStartsAt ?? null,
      reason: extra.reason ?? null,
      portalUrl: `${siteConfig.url}/candidate`,
      sequence: Math.max(0, (count ?? 1) - 1),
    },
  };
}

async function log(supabase: Supabase, interviewId: string, to: string, subject: string, status: EmailOutcome["status"], providerId: string | null, error: string | null) {
  const { error: logError } = await supabase.rpc("log_interview_email", {
    p_interview_id: interviewId,
    p_recipient: to,
    p_subject: subject,
    p_status: status,
    p_provider_message_id: providerId,
    p_error: error,
  });
  if (logError) console.error("Interview email log failed", logError.code, logError.message);
}

/**
 * Sends one interview email to the candidate and records the attempt. Never claims delivery:
 * "sent" means Resend accepted the message.
 */
export async function sendInterviewEmail(
  supabase: Supabase,
  interviewId: string,
  kind: InterviewEmailKind,
  extra: { previousStartsAt?: string | null; reason?: string | null } = {},
): Promise<EmailOutcome> {
  const loaded = await loadInterviewEmailData(supabase, interviewId, extra);
  if (!loaded) return { status: "failed", message: "The interview could not be loaded, so no email was sent." };
  const { data, to, optedOut } = loaded;
  const email = renderInterviewEmail(kind, data);
  const recipient = to ?? "(no email on file)";

  if (!to) {
    await log(supabase, interviewId, recipient, email.subject, "skipped", null, "Candidate has no email address");
    return { status: "skipped", message: "No email sent: the candidate has no email address on file." };
  }
  if (optedOut) {
    await log(supabase, interviewId, to, email.subject, "skipped", null, "Candidate turned off application emails");
    return { status: "skipped", message: "No email sent: the candidate turned off application emails. Let them know another way." };
  }

  let config: ReturnType<typeof getMarketConfig>["email"] = null;
  try {
    config = getMarketConfig().email;
  } catch (e) {
    console.error("Email configuration invalid", e instanceof Error ? e.message : e);
  }
  if (!config) {
    await log(supabase, interviewId, to, email.subject, "skipped", null, "Email is not configured");
    return { status: "skipped", message: "No email sent: email isn't set up yet (RESEND_API_KEY and a verified sender). Let the candidate know another way." };
  }

  const ics = buildInterviewIcs(kind, data);
  const result = await sendEmail(fetch, {
    apiKey: config.apiKey,
    from: config.from,
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    category: "interview",
    idempotencyKey: `interview-${interviewId}-${kind}-${data.sequence}`,
    attachments: [{ filename: "interview.ics", content: Buffer.from(ics, "utf8").toString("base64"), content_type: "text/calendar" }],
  });

  if (result.ok) {
    await log(supabase, interviewId, to, email.subject, "sent", result.providerMessageId, null);
    return { status: "sent", message: `Email accepted by the email provider for ${to}.` };
  }
  await log(supabase, interviewId, to, email.subject, "failed", null, result.error);
  return { status: "failed", message: `The email to ${to} failed: ${result.error}` };
}
