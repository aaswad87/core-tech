import { z } from "zod";

import { MARKET_SOURCES } from "@/lib/market/types";

const MAX_TERM = 80;

/** "network engineer, BGP\nSD-WAN" → ["network engineer", "BGP", "SD-WAN"] (deduped case-insensitively). */
export function parseTerms(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const term = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
  }
  return out;
}

const terms = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const list = parseTerms(v ?? "");
      if (list.length < min) ctx.addIssue({ code: "custom", message: `Add at least ${min} ${label.toLowerCase()}.` });
      if (list.length > max) ctx.addIssue({ code: "custom", message: `Use at most ${max} ${label.toLowerCase()}.` });
      const long = list.find((t) => t.length > MAX_TERM);
      if (long) ctx.addIssue({ code: "custom", message: `Keep each entry under ${MAX_TERM} characters.` });
      return list;
    });

export const huntSchema = z.object({
  name: z.string({ error: "Name the hunt." }).trim().min(1, "Name the hunt.").max(120, "Use 120 characters or fewer."),
  keywords: terms("keywords", { min: 1, max: 25 }),
  excludeKeywords: terms("excluded words", { min: 0, max: 25 }),
  locations: terms("locations", { min: 0, max: 20 }),
  includeRemote: z.preprocess((v) => v === "on", z.boolean()),
  sources: z.array(z.enum(MARKET_SOURCES)).min(1, "Choose at least one source.").max(4),
  minScore: z.coerce.number({ error: "Enter a number." }).int("Use a whole number.").min(1, "Minimum is 1.").max(30, "Maximum is 30."),
});

export type HuntInput = z.infer<typeof huntSchema>;

/**
 * Accepts a board token or a careers URL and extracts the token:
 *   https://boards.greenhouse.io/acme, https://job-boards.greenhouse.io/acme/jobs/123 → "acme"
 *   https://jobs.lever.co/acme, https://jobs.lever.co/acme/1234-… → "acme"
 */
export function extractBoardToken(input: string, source: "greenhouse" | "lever"): string | null {
  const raw = input.trim();
  let token = raw;
  if (/^https?:\/\//i.test(raw) || raw.includes("/")) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = url.hostname.toLowerCase();
      const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
      const greenhouseHost = host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io";
      const leverHost = host === "jobs.lever.co" || host === "jobs.eu.lever.co";
      if ((source === "greenhouse" && !greenhouseHost) || (source === "lever" && !leverHost)) return null;
      token = first;
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(token) ? token : null;
}

export const watchCompanySchema = z
  .object({
    companyName: z.string({ error: "Enter the company name." }).trim().min(1, "Enter the company name.").max(200),
    source: z.enum(["greenhouse", "lever"], { error: "Choose the careers platform." }),
    board: z.string({ error: "Paste the careers page link or board name." }).trim().min(1, "Paste the careers page link or board name.").max(300),
  })
  .transform((v, ctx) => {
    const boardToken = extractBoardToken(v.board, v.source);
    if (!boardToken) {
      ctx.addIssue({
        code: "custom",
        path: ["board"],
        message:
          v.source === "greenhouse"
            ? "Use a link like https://boards.greenhouse.io/companyname or just the board name."
            : "Use a link like https://jobs.lever.co/companyname or just the board name.",
      });
      return z.NEVER;
    }
    return { companyName: v.companyName, source: v.source, boardToken };
  });

export const matchStatusSchema = z.enum(["new", "reviewing", "dismissed"]);
