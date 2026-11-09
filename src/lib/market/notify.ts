/**
 * Alert rendering and delivery for the Job Market Radar. All job data comes from outside sources, so
 * it is escaped for each channel (HTML for email, Slack mrkdwn for Slack). A delivery is reported as
 * "sent" only when the provider accepts it — that is not proof the message reached an inbox.
 */

export type DigestItem = {
  matchId: string;
  huntName: string;
  title: string;
  companyName: string | null;
  location: string | null;
  isRemote: boolean;
  publisher: string | null;
  score: number;
  matchedTerms: string[];
};

export type DeliveryResult = { ok: true; providerMessageId: string | null } | { ok: false; error: string };

const MAX_ITEMS = 25;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Slack mrkdwn requires escaping &, < and >; this also stops injected <!channel> mentions and links. */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const matchUrl = (appUrl: string, id: string) => `${appUrl}/recruiter/market/${encodeURIComponent(id)}`;
const where = (i: DigestItem) => [i.location, i.isRemote ? "Remote" : null].filter(Boolean).join(" · ");

function subjectFor(items: DigestItem[]): string {
  const companies = [...new Set(items.map((i) => i.companyName).filter(Boolean))] as string[];
  const named = companies.slice(0, 3).join(", ");
  const more = companies.length > 3 ? ` +${companies.length - 3} more` : "";
  const count = `${items.length} new matching ${items.length === 1 ? "job" : "jobs"}`;
  return (named ? `Job Radar: ${count} — ${named}${more}` : `Job Radar: ${count}`).slice(0, 200).replace(/[\r\n]+/g, " ");
}

export function renderDigestEmail(items: DigestItem[], appUrl: string): { subject: string; html: string; text: string } {
  const shown = items.slice(0, MAX_ITEMS);
  const extra = items.length - shown.length;

  const rows = shown
    .map((i) => {
      const meta = [i.companyName, where(i), i.publisher && `via ${i.publisher}`].filter(Boolean).join(" · ");
      return `
      <tr><td style="padding:14px 0;border-bottom:1px solid #e5e3ef">
        <a href="${escapeHtml(matchUrl(appUrl, i.matchId))}" style="color:#5b21b6;font-size:16px;font-weight:600;text-decoration:none">${escapeHtml(i.title)}</a>
        <div style="color:#4b5563;font-size:14px;margin-top:4px">${escapeHtml(meta)}</div>
        <div style="color:#0f766e;font-size:13px;margin-top:6px">Fit ${i.score} · matched: ${escapeHtml(i.matchedTerms.join(", "))} · hunt: ${escapeHtml(i.huntName)}</div>
      </td></tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f8f7fc;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;padding:28px">
      <tr><td>
        <div style="font-size:13px;font-weight:700;letter-spacing:.06em;color:#6d28d9;text-transform:uppercase">CoreTech Job Radar</div>
        <h1 style="font-size:22px;margin:8px 0 4px">${escapeHtml(subjectFor(items).replace(/^Job Radar: /, ""))}</h1>
        <p style="color:#4b5563;font-size:14px;margin:0 0 8px">New postings that fit your saved hunts. Review each one before reaching out.</p>
      </td></tr>
      ${rows}
      ${extra > 0 ? `<tr><td style="padding-top:14px;color:#4b5563;font-size:14px">…and ${extra} more in the Job Radar inbox.</td></tr>` : ""}
      <tr><td style="padding-top:20px">
        <a href="${escapeHtml(`${appUrl}/recruiter/market`)}" style="display:inline-block;background:#6d28d9;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Open Job Radar</a>
      </td></tr>
      <tr><td style="padding-top:20px;color:#6b7280;font-size:12px">You get this because you subscribed to these hunts in CoreTech. Unsubscribe from a hunt on its page.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    "CoreTech Job Radar",
    subjectFor(items),
    "",
    ...shown.flatMap((i) => [
      i.title,
      `  ${[i.companyName, where(i), i.publisher && `via ${i.publisher}`].filter(Boolean).join(" · ")}`,
      `  Fit ${i.score} · matched: ${i.matchedTerms.join(", ")} · hunt: ${i.huntName}`,
      `  ${matchUrl(appUrl, i.matchId)}`,
      "",
    ]),
    extra > 0 ? `…and ${extra} more: ${appUrl}/recruiter/market` : `Open Job Radar: ${appUrl}/recruiter/market`,
  ].join("\n");

  return { subject: subjectFor(items), html, text };
}

export function renderSlackMessage(items: DigestItem[], appUrl: string): { text: string } {
  const shown = items.slice(0, 10);
  const lines = shown.map((i) => {
    const meta = [i.companyName, where(i), i.publisher && `via ${i.publisher}`].filter(Boolean).join(" · ");
    return `• <${matchUrl(appUrl, i.matchId)}|${escapeSlack(i.title)}> — ${escapeSlack(meta)} (fit ${i.score}: ${escapeSlack(i.matchedTerms.join(", "))})`;
  });
  const extra = items.length - shown.length;
  return {
    text: [
      `*CoreTech Job Radar:* ${items.length} new matching ${items.length === 1 ? "job" : "jobs"}`,
      ...lines,
      extra > 0 ? `…and ${extra} more in <${appUrl}/recruiter/market|Job Radar>` : `<${appUrl}/recruiter/market|Open Job Radar>`,
    ].join("\n"),
  };
}

function shortError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/** Resend: POST /emails. Idempotency-Key stops duplicates if a scan is retried. */
export async function sendEmail(
  fetchImpl: typeof fetch,
  opts: {
    apiKey: string;
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
    category?: string;
    /** Base64 content, e.g. a calendar invite. */
    attachments?: { filename: string; content: string; content_type?: string }[];
  },
): Promise<DeliveryResult> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": opts.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        tags: [{ name: "category", value: opts.category ?? "job_radar" }],
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
    if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}${typeof body.message === "string" ? `: ${body.message.slice(0, 200)}` : ""}` };
    return { ok: true, providerMessageId: typeof body.id === "string" ? body.id : null };
  } catch (e) {
    return { ok: false, error: shortError(e) };
  }
}

/** Slack incoming webhook. Slack replies with plain-text "ok" on success. */
export async function sendSlack(fetchImpl: typeof fetch, webhookUrl: string, payload: { text: string }): Promise<DeliveryResult> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, unfurl_links: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `Slack HTTP ${res.status}` };
    return { ok: true, providerMessageId: null };
  } catch (e) {
    return { ok: false, error: shortError(e) };
  }
}
