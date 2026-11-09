"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAdmin } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import {
  commissionPaidSchema,
  commissionSchema,
  invoiceSchema,
  paymentSchema,
  placementTermsSchema,
  reasonSchema,
  statusChangeSchema,
} from "@/lib/finance/validation";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

/** Finance is administrators only. Every database function checks this again. */
async function adminClient() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return null;
  return createClient();
}

const NOT_ADMIN: FormState = { status: "error", message: "Only administrators can change finance records." };

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some values aren't allowed. Check the amounts and dates.";
  console.error("Finance action failed", error.code, error.message);
  return fallback;
}

function read<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, formString(formData, k)])) as Record<K, string>;
}

function refresh(paths: string[]) {
  revalidatePath("/recruiter/finance");
  revalidatePath("/recruiter/commissions");
  for (const p of paths) revalidatePath(p);
}

function invalid(error: Parameters<typeof toFieldErrors>[0], values?: Record<string, string>): FormState {
  const fieldErrors = toFieldErrors(error);
  return { status: "error", message: "Please correct the highlighted fields.", fieldErrors, values };
}

const TERM_FIELDS = ["offerAcceptedOn", "startDate", "baseSalary", "feeType", "feePercent", "feeFlat", "guaranteeDays", "notes"] as const;

function termArgs(d: ReturnType<typeof placementTermsSchema.parse>) {
  return {
    p_offer_accepted_on: d.offerAcceptedOn,
    p_start_date: d.startDate,
    p_base_salary: d.baseSalary,
    p_fee_type: d.feeType,
    p_fee_percent: d.feeType === "percentage" ? (d.feePercent ?? null) : null,
    p_fee_flat: d.feeType === "flat" ? (d.feeFlat ?? null) : null,
    p_guarantee_days: d.guaranteeDays,
    p_notes: d.notes ?? null,
  };
}

export async function createPlacement(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, [...TERM_FIELDS, "applicationId"] as const);
  const parsed = placementTermsSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { data, error } = await supabase.rpc("create_placement", { p_application_id: values.applicationId, ...termArgs(parsed.data) });
  if (error || !data) return { status: "error", message: error ? dbMessage(error, "The placement could not be saved.") : "The placement could not be saved.", values };
  refresh([]);
  redirect(`/recruiter/finance/placements/${data as string}?notice=created`);
}

export async function updatePlacementTerms(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, [...TERM_FIELDS, "placementId"] as const);
  const parsed = placementTermsSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { error } = await supabase.rpc("update_placement_terms", { p_placement_id: values.placementId, ...termArgs(parsed.data) });
  if (error) return { status: "error", message: dbMessage(error, "The placement could not be updated."), values };
  refresh([`/recruiter/finance/placements/${values.placementId}`]);
  return { status: "success", message: "Terms saved. Check any draft invoices still match the fee." };
}

export async function changePlacementStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["placementId", "status", "fellOffOn", "reason", "resolution", "refundAmount"] as const);
  const parsed = statusChangeSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const d = parsed.data;
  const { error } = await supabase.rpc("set_placement_status", {
    p_placement_id: d.placementId,
    p_status: d.status,
    p_fell_off_on: d.fellOffOn ?? null,
    p_reason: d.reason ?? null,
    p_resolution: d.resolution ?? null,
    p_refund_amount: d.refundAmount ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The status could not be changed."), values };
  refresh([`/recruiter/finance/placements/${d.placementId}`]);
  return {
    status: "success",
    message:
      d.resolution === "refund" || d.resolution === "partial_refund"
        ? "Fall-off recorded. Issue a credit note for the refund, then record the refund payment on it."
        : "Status updated.",
  };
}

export async function linkReplacement(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const placementId = formString(formData, "placementId");
  const replacementId = formString(formData, "replacementId");
  if (!replacementId) return { status: "error", message: "Choose the replacement placement." };
  const { error } = await supabase.rpc("link_replacement", { p_placement_id: placementId, p_replacement_id: replacementId });
  if (error) return { status: "error", message: dbMessage(error, "The replacement could not be linked.") };
  refresh([`/recruiter/finance/placements/${placementId}`]);
  return { status: "success", message: "Replacement linked." };
}

export async function setCommission(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["placementId", "recruiterId", "splitPercent", "ratePercent"] as const);
  const parsed = commissionSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { error } = await supabase.rpc("set_commission", {
    p_placement_id: parsed.data.placementId,
    p_recruiter_id: parsed.data.recruiterId,
    p_split_percent: parsed.data.splitPercent,
    p_rate_percent: parsed.data.ratePercent,
  });
  if (error) return { status: "error", message: dbMessage(error, "The commission could not be saved."), values };
  refresh([`/recruiter/finance/placements/${parsed.data.placementId}`]);
  return { status: "success", message: "Commission saved." };
}

export async function removeCommission(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const { error } = await supabase.rpc("remove_commission", { p_commission_id: formString(formData, "commissionId") });
  if (error) return { status: "error", message: dbMessage(error, "The commission could not be removed.") };
  refresh([`/recruiter/finance/placements/${formString(formData, "placementId")}`]);
  return { status: "success", message: "Removed." };
}

export async function markCommissionPaid(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["commissionId", "paidOn", "amount"] as const);
  const parsed = commissionPaidSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { error } = await supabase.rpc("mark_commission_paid", {
    p_commission_id: parsed.data.commissionId,
    p_paid_on: parsed.data.paidOn,
    p_amount: parsed.data.amount,
  });
  if (error) return { status: "error", message: dbMessage(error, "The payout could not be recorded."), values };
  refresh([`/recruiter/finance/placements/${formString(formData, "placementId")}`]);
  return { status: "success", message: "Payout recorded." };
}

export async function createInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["placementId", "kind", "creditsInvoiceId", "amount", "issueDate", "dueDate", "description"] as const);
  const parsed = invoiceSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const d = parsed.data;
  const { data, error } = await supabase.rpc("create_invoice", {
    p_placement_id: d.placementId,
    p_kind: d.kind,
    p_credits_invoice_id: d.creditsInvoiceId ?? null,
    p_amount: d.amount,
    p_issue_date: d.issueDate,
    p_due_date: d.dueDate,
    p_description: d.description,
  });
  if (error || !data) return { status: "error", message: error ? dbMessage(error, "The invoice could not be created.") : "The invoice could not be created.", values };
  refresh([`/recruiter/finance/placements/${d.placementId}`]);
  redirect(`/recruiter/finance/invoices/${data as string}`);
}

export async function markInvoiceSent(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const invoiceId = formString(formData, "invoiceId");
  const { error } = await supabase.rpc("mark_invoice_sent", { p_invoice_id: invoiceId });
  if (error) return { status: "error", message: dbMessage(error, "The invoice could not be updated.") };
  refresh([`/recruiter/finance/invoices/${invoiceId}`]);
  return { status: "success", message: "Marked as sent. Email or post the invoice to the client yourself — the app doesn't send it." };
}

export async function voidInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const parsed = reasonSchema.safeParse({ id: formString(formData, "invoiceId"), reason: formString(formData, "reason") });
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return { status: "error", message: dbMessage(error, "The invoice could not be voided.") };
  refresh([`/recruiter/finance/invoices/${parsed.data.id}`]);
  return { status: "success", message: "Invoice voided." };
}

export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["invoiceId", "amount", "receivedOn", "method", "reference"] as const);
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const d = parsed.data;
  const { error } = await supabase.rpc("record_payment", {
    p_invoice_id: d.invoiceId,
    p_amount: d.amount,
    p_received_on: d.receivedOn,
    p_method: d.method,
    p_reference: d.reference ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The payment could not be recorded."), values };
  refresh([`/recruiter/finance/invoices/${d.invoiceId}`]);
  return { status: "success", message: "Payment recorded." };
}

export async function deletePayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const parsed = reasonSchema.safeParse({ id: formString(formData, "paymentId"), reason: formString(formData, "reason") });
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await supabase.rpc("delete_payment", { p_payment_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return { status: "error", message: dbMessage(error, "The payment could not be removed.") };
  refresh([`/recruiter/finance/invoices/${formString(formData, "invoiceId")}`]);
  return { status: "success", message: "Payment removed. The audit log keeps a record." };
}
