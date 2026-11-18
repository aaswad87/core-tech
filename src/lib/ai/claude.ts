import Anthropic from "@anthropic-ai/sdk";

import { PROPOSAL_JSON_SCHEMA, SYSTEM_PROMPT } from "@/lib/ai/proposal";

export type ProviderResult =
  | { ok: true; json: unknown; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; error: string; inputTokens: number | null; outputTokens: number | null };

/** Room for the proposal plus the model's (adaptive) thinking. */
const MAX_OUTPUT_TOKENS = 16_000;

/** The subset of the Anthropic client this module uses, so tests can pass a fake. */
export type MessagesClient = Pick<Anthropic, "messages">;

/** Builds the real client. Server-only: the key comes from server environment variables. */
export function createClaudeClient(apiKey: string, timeoutMs = 90_000): MessagesClient {
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
}

/**
 * One structured-output request to the Claude Messages API. Never throws: every failure becomes a short,
 * loggable message (no resume text, no API key).
 */
export async function proposeWithClaude(
  client: MessagesClient,
  opts: { model: string; resumeText: string },
): Promise<ProviderResult> {
  const none = { inputTokens: null, outputTokens: null };
  try {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Resume text (contact details already removed):\n\n<resume>\n${opts.resumeText}\n</resume>`,
        },
      ],
      // Extraction is routine work: low effort keeps thinking (and cost) small.
      output_config: { effort: "low", format: { type: "json_schema", schema: PROPOSAL_JSON_SCHEMA } },
    });

    const usage = { inputTokens: response.usage.input_tokens ?? null, outputTokens: response.usage.output_tokens ?? null };
    if (response.stop_reason === "refusal") return { ok: false, error: "The AI declined to process this resume.", ...usage };
    if (response.stop_reason === "max_tokens") return { ok: false, error: "The AI response was cut off; the resume may be too long.", ...usage };

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) return { ok: false, error: "The AI returned an empty response.", ...usage };
    try {
      return { ok: true, json: JSON.parse(text), ...usage };
    } catch {
      return { ok: false, error: "The AI response wasn't valid JSON.", ...usage };
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "AI provider error: the API key was rejected.", ...none };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "AI provider error: the provider's rate limit or spending limit was reached.", ...none };
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: "The AI provider didn't respond in time.", ...none };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: "Couldn't reach the AI provider.", ...none };
    if (e instanceof Anthropic.APIError) {
      const status = typeof e.status === "number" ? e.status : 0;
      const reason = status >= 500 ? "the provider had a temporary error" : `HTTP ${status || "error"}`;
      return { ok: false, error: `AI provider error: ${reason}.`, ...none };
    }
    return { ok: false, error: "Couldn't reach the AI provider.", ...none };
  }
}
