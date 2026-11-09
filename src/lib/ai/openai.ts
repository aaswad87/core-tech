import { PROPOSAL_JSON_SCHEMA, SYSTEM_PROMPT } from "@/lib/ai/proposal";

export type ProviderResult =
  | { ok: true; json: unknown; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; error: string; inputTokens: number | null; outputTokens: number | null };

const MAX_OUTPUT_TOKENS = 4000;

/**
 * One structured-output request to the OpenAI Chat Completions API. Never throws: every failure becomes a
 * short, loggable message (no resume text, no API key).
 */
export async function proposeWithOpenAI(
  fetchImpl: typeof fetch,
  opts: { apiKey: string; model: string; resumeText: string; timeoutMs?: number },
): Promise<ProviderResult> {
  const none = { inputTokens: null, outputTokens: null };
  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Resume text (contact details already removed):\n\n<resume>\n${opts.resumeText}\n</resume>` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "resume_proposal", strict: true, schema: PROPOSAL_JSON_SCHEMA } },
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });

    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string; code?: string };
    } | null;
    const usage = { inputTokens: body?.usage?.prompt_tokens ?? null, outputTokens: body?.usage?.completion_tokens ?? null };

    if (!res.ok) {
      const reason =
        res.status === 401 ? "the API key was rejected" :
        res.status === 429 ? "the provider's rate limit or quota was reached" :
        res.status >= 500 ? "the provider had a temporary error" :
        (body?.error?.message ?? `HTTP ${res.status}`).slice(0, 200);
      return { ok: false, error: `AI provider error: ${reason}.`, ...usage };
    }
    const choice = body?.choices?.[0];
    if (choice?.message?.refusal) return { ok: false, error: "The AI declined to process this resume.", ...usage };
    if (choice?.finish_reason === "length") return { ok: false, error: "The AI response was cut off; the resume may be too long.", ...usage };
    const content = choice?.message?.content;
    if (!content) return { ok: false, error: "The AI returned an empty response.", ...usage };
    try {
      return { ok: true, json: JSON.parse(content), ...usage };
    } catch {
      return { ok: false, error: "The AI response wasn't valid JSON.", ...usage };
    }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? "The AI provider didn't respond in time." : "Couldn't reach the AI provider.", ...none };
  }
}
