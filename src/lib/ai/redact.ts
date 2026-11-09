/**
 * Removes direct contact details before resume text leaves our servers. The AI provider never needs them
 * to propose skills or work history, and the candidate record already holds the real values.
 */
export function redactContactDetails(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const swap = (label: string) => () => {
    redactions++;
    return `[${label} removed]`;
  };
  const out = text
    // Email addresses
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, swap("email"))
    // URLs (LinkedIn, portfolios, GitHub) — keep them out; they often contain names and photos
    .replace(/\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi, swap("link"))
    .replace(/\b(?:linkedin\.com|github\.com)\/[^\s)>\]]+/gi, swap("link"))
    // Phone numbers: 10+ digits with common separators
    .replace(/(?<!\w)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/g, swap("phone"))
    // US street addresses: "123 Main St", "4500 Elm Avenue Apt 2"
    .replace(
      /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Pl|Place|Cir|Circle)\b\.?(?:,?\s*(?:Apt|Suite|Ste|Unit|#)\s*[\w-]+)?/g,
      swap("address"),
    );
  return { text: out, redactions };
}

/** Collapses whitespace so long PDFs fit the input cap without losing content. */
export function normalizeResumeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
