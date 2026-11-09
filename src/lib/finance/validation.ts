import { z } from "zod";

export const PLACEMENT_STATUS = [
  { value: "pending_start", label: "Offer accepted — not started" },
  { value: "started", label: "Started" },
  { value: "fell_off", label: "Fell off" },
  { value: "cancelled", label: "Cancelled before start" },
] as const;

export const RESOLUTIONS = [
  { value: "replacement", label: "Free replacement" },
  { value: "refund", label: "Full refund" },
  { value: "partial_refund", label: "Partial refund" },
  { value: "none", label: "No refund or replacement" },
] as const;

export const INVOICE_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
] as const;

export const PAYMENT_METHODS = [
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

export const COMMISSION_STATUS: Record<string, { label: string; help: string }> = {
  forecast: { label: "Forecast", help: "The placement hasn't started yet." },
  earned: { label: "Earned", help: "The placement started; the client hasn't paid the fee in full yet." },
  payable: { label: "Payable", help: "The client paid the fee in full." },
  paid: { label: "Paid", help: "Payout recorded." },
  clawed_back: { label: "Clawed back", help: "The placement fell off and the fee was refunded in full." },
  cancelled: { label: "Cancelled", help: "The placement never started." },
};

/** Plain-language definitions shown next to the totals, so the four numbers are never confused. */
export const BUCKETS = {
  forecast: "Fees on accepted offers starting in this period. Not money yet — offers can fall through.",
  earned: "Fees on placements that started in this period, minus refunds owed for fall-offs.",
  invoiced: "Invoices sent in this period (direct-hire and contract), minus credit notes. Drafts and voided invoices aren't counted.",
  collected: "Payments received in this period (direct-hire and contract), minus refunds paid back to clients.",
} as const;

export const labelOf = (list: readonly { value: string; label: string }[], value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? value ?? "";

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
export const usd = (v: number | string | null | undefined) => usdFormat.format(Number(v ?? 0));

const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v);
const money = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.replace(/[$,\s]/g, "")) : v),
    z.coerce.number({ error: `Enter ${label}.` }).positive(`${label[0].toUpperCase()}${label.slice(1)} must be more than 0.`).max(10_000_000, "Too large."),
  );
const optionalMoney = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.replace(/[$,\s]/g, "")) : v),
  z.coerce.number({ error: "Enter a number." }).positive("Must be more than 0.").max(10_000_000, "Too large.").optional(),
);
const percent = (label: string) =>
  z.coerce.number({ error: `Enter ${label}.` }).gt(0, "Must be more than 0.").max(100, "At most 100.");
const date = (label: string) => z.iso.date({ error: `Enter ${label}.` });

export const placementTermsSchema = z
  .object({
    offerAcceptedOn: date("the offer acceptance date"),
    startDate: date("the start date"),
    baseSalary: money("the base salary"),
    feeType: z.enum(["percentage", "flat"], { error: "Choose how the fee is set." }),
    feePercent: z.preprocess(blank, percent("the fee percentage").optional()),
    feeFlat: optionalMoney,
    guaranteeDays: z.coerce.number({ error: "Enter the guarantee period." }).int().min(0).max(365),
    notes: z.preprocess(blank, z.string().max(2000).optional()),
  })
  .refine((v) => v.startDate >= v.offerAcceptedOn, { path: ["startDate"], message: "Start date can't be before the offer was accepted." })
  .refine((v) => v.feeType !== "percentage" || v.feePercent !== undefined, { path: ["feePercent"], message: "Enter the fee percentage." })
  .refine((v) => v.feeType !== "flat" || v.feeFlat !== undefined, { path: ["feeFlat"], message: "Enter the flat fee." });

/** Fee preview matching the database's generated column. */
export function computeFee(v: { feeType: string; baseSalary?: number; feePercent?: number; feeFlat?: number }): number | null {
  if (v.feeType === "flat") return v.feeFlat ?? null;
  if (v.baseSalary === undefined || v.feePercent === undefined) return null;
  return Math.round(v.baseSalary * v.feePercent) / 100;
}

export const statusChangeSchema = z
  .object({
    placementId: z.uuid(),
    status: z.enum(["started", "cancelled", "fell_off"], { error: "Choose the new status." }),
    fellOffOn: z.preprocess(blank, date("the date they left").optional()),
    reason: z.preprocess(blank, z.string().max(1000).optional()),
    resolution: z.preprocess(blank, z.enum(["replacement", "refund", "partial_refund", "none"]).optional()),
    refundAmount: optionalMoney,
  })
  .refine((v) => v.status === "started" || Boolean(v.reason), { path: ["reason"], message: "Give a reason." })
  .refine((v) => v.status !== "fell_off" || Boolean(v.fellOffOn), { path: ["fellOffOn"], message: "Enter the date they left." })
  .refine((v) => v.status !== "fell_off" || Boolean(v.resolution), { path: ["resolution"], message: "Choose how it's resolved." })
  .refine((v) => !(v.resolution === "refund" || v.resolution === "partial_refund") || v.refundAmount !== undefined, {
    path: ["refundAmount"],
    message: "Enter the refund amount.",
  });

export const commissionSchema = z
  .object({
    placementId: z.uuid(),
    recruiterId: z.uuid("Choose a recruiter."),
    splitPercent: percent("the split"),
    ratePercent: percent("the commission rate"),
  });

export const invoiceSchema = z
  .object({
    placementId: z.uuid(),
    kind: z.enum(["invoice", "credit_note"]),
    creditsInvoiceId: z.preprocess(blank, z.uuid().optional()),
    amount: money("the amount"),
    issueDate: date("the issue date"),
    dueDate: date("the due date"),
    description: z.string().trim().min(1, "Describe the invoice.").max(1000),
  })
  .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "Due date can't be before the issue date." })
  .refine((v) => v.kind === "invoice" || Boolean(v.creditsInvoiceId), { path: ["creditsInvoiceId"], message: "Choose the invoice to credit." });

export const paymentSchema = z.object({
  invoiceId: z.uuid(),
  amount: money("the amount"),
  receivedOn: date("the date received"),
  method: z.enum(["ach", "wire", "check", "card", "other"], { error: "Choose a method." }),
  reference: z.preprocess(blank, z.string().max(200).optional()),
});

export const reasonSchema = z.object({ id: z.uuid(), reason: z.string().trim().min(1, "Give a reason.").max(500) });

export const commissionPaidSchema = z.object({
  commissionId: z.uuid(),
  paidOn: date("the payout date"),
  amount: z.preprocess((v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v), z.coerce.number().min(0).max(10_000_000)),
});
