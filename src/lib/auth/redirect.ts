export const DEFAULT_AFTER_LOGIN = "/account";

/**
 * Accepts only same-origin relative paths so `?next=` cannot be used as an open redirect.
 * Rejects protocol-relative URLs (//evil.test), backslash tricks (/\evil.test) and control characters.
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;

  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
