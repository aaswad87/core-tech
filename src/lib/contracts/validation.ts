import { z } from "zod";

export const EMPLOYMENT_MODELS = [
  { value: "w2_payroll_provider", label: "W-2 through a payroll provider / EOR" },
  { value: "c2c", label: "Corp-to-corp (worker's own company)" },
  { value: "1099", label: "1099 independent contractor" },
] as const;

export const PAY_FREQUENCIES = [
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "biweekly", label: "Every two weeks", days: 14 },
  { value: "semimonthly", label: "Twice a month", days: 15 },
  { value: "monthly", label: "Monthly", days: 30 },
] as const;

export const ASSIGNMENT_STATUS = [
  { value: "pending", label: "Pending start" },
  { value: "active", label: "Active" },
  { value: "ended", label: "Ended" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const TIMESHEET_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Waiting for client approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Sent back" },
] as const;

export const PAYROLL_STATUS = [
  { value: "not_ready", label: "Not approved yet" },
  { value: "ready", label: "Ready for payroll" },
  { value: "sent_to_provider", label: "Sent to payroll provider" },
  { value: "paid_by_provider", label: "Paid by provider" },
] as const;

export const labelOf = (list: readonly { value: string; label: string }[], value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? value ?? "";

/** Shown on every contract page until payroll, insurance, legal and funding are verified. */
export const NOT_PAYROLL_NOTICE =
  "Contract staffing here is tracking only. CoreTech does not run payroll, withhold taxes or pay workers from this app. " +
  "Before placing real contractors, confirm a payroll provider or employer of record, workers' comp and liability insurance, " +
  "worker classification with an employment attorney, and funding to cover pay before clients pay.";

// --- Money ------------------------------------------------------------------

export type RateInputs = {
  billRate: number;
  payRate: number;
  burdenPercent: number;
  clientTermsDays: number;
  payFrequency: string;
  employmentModel: string;
};

/** Per-hour economics, matching the database formulas. */
export function hourlyEconomics(r: Pick<RateInputs, "billRate" | "payRate" | "burdenPercent">) {
  const spread = round2(r.billRate - r.payRate);
  const burden = round2((r.payRate * r.burdenPercent) / 100);
  const net = round2(spread - burden);
  return { spread, burden, net, netMarginPercent: r.billRate > 0 ? round2((net / r.billRate) * 100) : 0, markupPercent: r.payRate > 0 ? round2(((r.billRate - r.payRate) / r.payRate) * 100) : 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type Warning = { level: "danger" | "warning" | "info"; message: string };

/**
 * Plain-language risk warnings for an assignment. Cash-flow gap: a week is worked, invoiced at the end of
 * the week, and paid by the client `clientTermsDays` later; the worker is paid on the provider's cycle.
 */
export function assignmentWarnings(r: RateInputs): Warning[] {
  const out: Warning[] = [];
  const e = hourlyEconomics(r);
  if (r.billRate <= r.payRate) out.push({ level: "danger", message: "The bill rate doesn't cover the pay rate — every hour loses money." });
  else if (e.net < 0) out.push({ level: "danger", message: `After the estimated ${r.burdenPercent}% burden, each hour loses ${Math.abs(e.net).toFixed(2)} USD.` });
  else if (e.netMarginPercent < 10) out.push({ level: "warning", message: `Thin margin: about ${e.netMarginPercent}% of billing after estimated burden.` });

  const payDays = PAY_FREQUENCIES.find((f) => f.value === r.payFrequency)?.days ?? 7;
  const gap = 7 + r.clientTermsDays - payDays;
  if (gap > 0) {
    out.push({
      level: gap > 30 ? "warning" : "info",
      message: `Cash-flow gap: you'll pay the worker roughly ${gap} days before the client pays for the same week (net ${r.clientTermsDays} terms, ${labelOf(PAY_FREQUENCIES, r.payFrequency).toLowerCase()} pay). Make sure funding covers it.`,
    });
  }
  if (r.employmentModel === "1099") {
    out.push({ level: "warning", message: "1099 classification is risky for full-time, client-directed work. Confirm with an employment attorney." });
  }
  if (r.employmentModel === "c2c") {
    out.push({ level: "info", message: "Corp-to-corp: get the worker's company W-9, certificate of insurance and a subcontractor agreement." });
  }
  return out;
}

/** Exposure is unpaid-by-client worker cost CoreTech has already incurred. */
export function exposureWarning(exposure: number, billing: number): Warning | null {
  if (exposure <= 0) return null;
  if (exposure >= 25_000) return { level: "danger", message: `High cash exposure: ${exposure.toLocaleString("en-US", { style: "currency", currency: "USD" })} of worker cost isn't covered by client payments yet.` };
  if (billing > 0 && exposure / billing > 0.5) return { level: "warning", message: "More than half of this assignment's worker cost hasn't been paid for by the client yet." };
  return { level: "info", message: `${exposure.toLocaleString("en-US", { style: "currency", currency: "USD" })} of worker cost isn't covered by client payments yet.` };
}

// --- Schemas ----------------------------------------------------------------

const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v);
const rate = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v),
    z.coerce.number({ error: `Enter the ${label}.` }).positive(`The ${label} must be more than 0.`).max(2000, "Too large."),
  );

export const assignmentSchema = z
  .object({
    assignmentId: z.preprocess(blank, z.uuid().optional()),
    candidateId: z.uuid("Choose the worker."),
    companyId: z.uuid("Choose the client."),
    jobId: z.preprocess(blank, z.uuid().optional()),
    title: z.string().trim().min(2, "Enter the role title.").max(200),
    employmentModel: z.enum(["w2_payroll_provider", "c2c", "1099"], { error: "Choose how the worker is engaged." }),
    startDate: z.iso.date({ error: "Enter the start date." }),
    endDate: z.preprocess(blank, z.iso.date({ error: "Enter a valid end date." }).optional()),
    billRate: rate("bill rate"),
    payRate: rate("pay rate"),
    otBillMultiplier: z.coerce.number().min(1).max(3),
    otPayMultiplier: z.coerce.number().min(1).max(3),
    burdenPercent: z.coerce.number({ error: "Enter the burden estimate." }).min(0).max(60),
    clientTermsDays: z.coerce.number({ error: "Enter the client's payment terms." }).int().min(0).max(120),
    payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
    notes: z.preprocess(blank, z.string().max(2000).optional()),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "End date can't be before the start." });

const hours = (label: string) => z.coerce.number({ error: `Enter ${label}.` }).min(0, "Can't be negative.").refine((n) => Number.isInteger(n * 4), "Use quarter hours.");

export const timesheetSchema = z
  .object({
    assignmentId: z.uuid(),
    weekStart: z.iso.date({ error: "Choose the week." }).refine((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1, "Weeks start on Monday."),
    regularHours: hours("regular hours").pipe(z.number().max(80, "At most 80 regular hours.")),
    overtimeHours: hours("overtime hours").pipe(z.number().max(60, "At most 60 overtime hours.")),
    notes: z.preprocess(blank, z.string().max(1000).optional()),
    submit: z.preprocess((v) => v === "true" || v === "on", z.boolean()),
  })
  .refine((v) => v.regularHours + v.overtimeHours > 0, { path: ["regularHours"], message: "Enter some hours." });

export const reviewSchema = z
  .object({ timesheetId: z.uuid(), approve: z.enum(["true", "false"]), note: z.preprocess(blank, z.string().max(1000).optional()) })
  .refine((v) => v.approve === "true" || Boolean(v.note), { path: ["note"], message: "Say what needs to change." });

/** Mondays from the assignment start (or 26 weeks back) through this week, newest first. */
export function recentMondays(startDate: string, endDate: string | null, today: Date = new Date()): string[] {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const out: string[] = [];
  for (let i = 0; i < 26; i++) {
    const iso = d.toISOString().slice(0, 10);
    const sunday = new Date(d.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    if (sunday < startDate) break;
    if (!endDate || iso <= endDate) out.push(iso);
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out;
}
