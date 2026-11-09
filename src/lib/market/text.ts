/**
 * Sanitizers for data from external job sources. Everything that comes back from a job board is
 * untrusted: it is reduced to plain text, length-capped, and only https links are kept.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * HTML (possibly entity-escaped, as Greenhouse returns it) → readable plain text.
 * The result is never rendered as HTML anywhere; this just makes it legible.
 */
export function htmlToText(input: string | null | undefined, maxLength = 4000): string | null {
  if (!input) return null;
  let text = input;
  // Greenhouse double-encodes: &lt;p&gt; → <p>
  for (let i = 0; i < 2 && /&(lt|gt|amp|#\d+);/i.test(text); i++) text = decodeEntities(text);
  text = text
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? truncate(text, maxLength) : null;
}

/** Single-line text field (title, company, location). */
export function cleanText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const text = decodeEntities(String(input))
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? truncate(text, maxLength) : null;
}

export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Only absolute https URLs survive; anything else (javascript:, data:, http:) is dropped. */
export function safeHttpsUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2000) return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function toIsoDate(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const date = typeof input === "number" ? new Date(input) : new Date(String(input));
  const time = date.getTime();
  // Reject nonsense dates (before 2000 or more than a day in the future).
  if (Number.isNaN(time) || time < Date.UTC(2000, 0, 1) || time > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

export function toMoney(input: unknown): number | null {
  const n = typeof input === "number" ? input : typeof input === "string" ? Number(input) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
}

/** Company|title|location in a normalized form, so the same job on two boards is recognized. */
export function dedupeKey(posting: { companyName: string | null; title: string; location: string | null }): string {
  const norm = (s: string | null) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b\.?/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return truncate(`${norm(posting.companyName)}|${norm(posting.title)}|${norm(posting.location)}`, 600);
}
