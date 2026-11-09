"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isAdmin } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { assignmentSchema, reviewSchema, timesheetSchema } from "@/lib/contracts/validation";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

async function adminClient() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return null;
  return createClient();
}

const NOT_ADMIN: FormState = { status: "error", message: "Only administrators can manage contract staffing." };

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some values aren't allowed. Check the rates, hours and dates.";
  console.error("Contract action failed", error.code, error.message);
  return fallback;
}

function read<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, formString(formData, k)])) as Record<K, string>;
}

function refresh(assignmentId?: string) {
  revalidatePath("/recruiter/contracts");
  revalidatePath("/recruiter/finance");
  if (assignmentId) revalidatePath(`/recruiter/contracts/${assignmentId}`);
}

const ASSIGNMENT_FIELDS = [
  "assignmentId", "candidateId", "companyId", "jobId", "title", "employmentModel", "startDate", "endDate", "billRate", "payRate",
  "otBillMultiplier", "otPayMultiplier", "burdenPercent", "clientTermsDays", "payFrequency", "notes",
] as const;

export async function saveAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ASSIGNMENT_FIELDS);
  const parsed = assignmentSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  const d = parsed.data;
  const { data, error } = await supabase.rpc("save_assignment", {
    p_assignment_id: d.assignmentId ?? null,
    p_candidate_id: d.candidateId,
    p_company_id: d.companyId,
    p_job_id: d.jobId ?? null,
    p_title: d.title,
    p_employment_model: d.employmentModel,
    p_start_date: d.startDate,
    p_end_date: d.endDate ?? null,
    p_bill_rate: d.billRate,
    p_pay_rate: d.payRate,
    p_ot_bill_multiplier: d.otBillMultiplier,
    p_ot_pay_multiplier: d.otPayMultiplier,
    p_burden_percent: d.burdenPercent,
    p_client_payment_terms_days: d.clientTermsDays,
    p_worker_pay_frequency: d.payFrequency,
    p_notes: d.notes ?? null,
  });
  if (error || !data) return { status: "error", message: error ? dbMessage(error, "The assignment could not be saved.") : "The assignment could not be saved.", values };
  refresh(data as string);
  if (!d.assignmentId) redirect(`/recruiter/contracts/${data as string}`);
  return { status: "success", message: "Saved. New timesheets use these rates; existing weeks keep the rates they were entered with." };
}

export async function setAssignmentStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const id = formString(formData, "assignmentId");
  const status = z.enum(["active", "ended", "cancelled"]).safeParse(formString(formData, "status"));
  if (!status.success) return { status: "error", message: "Choose a status." };
  const { error } = await supabase.rpc("set_assignment_status", { p_assignment_id: id, p_status: status.data });
  if (error) return { status: "error", message: dbMessage(error, "The status could not be changed.") };
  refresh(id);
  return { status: "success", message: "Status updated." };
}

export async function saveTimesheet(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["assignmentId", "weekStart", "regularHours", "overtimeHours", "notes", "submit"] as const);
  const parsed = timesheetSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  const d = parsed.data;
  const { error } = await supabase.rpc("save_timesheet", {
    p_assignment_id: d.assignmentId,
    p_week_start: d.weekStart,
    p_regular_hours: d.regularHours,
    p_overtime_hours: d.overtimeHours,
    p_notes: d.notes ?? null,
    p_submit: d.submit,
  });
  if (error) return { status: "error", message: dbMessage(error, "The timesheet could not be saved."), values };
  refresh(d.assignmentId);
  return { status: "success", message: d.submit ? "Saved and sent to the client for approval in their portal." : "Saved as a draft." };
}

/** Admin recording a client's approval given outside the portal (note required), or sending a week back. */
export async function reviewTimesheetAsStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const values = read(formData, ["timesheetId", "approve", "note"] as const);
  const parsed = reviewSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: Object.values(toFieldErrors(parsed.error))[0] ?? "Check the form.", values };
  const { error } = await supabase.rpc("review_timesheet", {
    p_timesheet_id: parsed.data.timesheetId,
    p_approve: parsed.data.approve === "true",
    p_note: parsed.data.note ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The timesheet could not be updated."), values };
  refresh(formString(formData, "assignmentId"));
  return { status: "success", message: parsed.data.approve === "true" ? "Approval recorded." : "Sent back." };
}

export async function setPayrollStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const status = z.enum(["ready", "sent_to_provider", "paid_by_provider"]).safeParse(formString(formData, "status"));
  if (!status.success) return { status: "error", message: "Choose a payroll status." };
  const { error } = await supabase.rpc("set_payroll_status", {
    p_timesheet_id: formString(formData, "timesheetId"),
    p_status: status.data,
    p_reference: formString(formData, "reference") || null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The payroll status could not be saved.") };
  refresh(formString(formData, "assignmentId"));
  return { status: "success", message: "Recorded." };
}

export async function createContractInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await adminClient();
  if (!supabase) return NOT_ADMIN;
  const assignmentId = formString(formData, "assignmentId");
  const ids = formData.getAll("timesheetIds").filter((v): v is string => typeof v === "string");
  const parsed = z
    .object({
      ids: z.array(z.uuid()).min(1, "Choose at least one approved week."),
      issueDate: z.iso.date({ error: "Enter the issue date." }),
      dueDate: z.iso.date({ error: "Enter the due date." }),
    })
    .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "Due date can't be before the issue date." })
    .safeParse({ ids, issueDate: formString(formData, "issueDate"), dueDate: formString(formData, "dueDate") });
  if (!parsed.success) return { status: "error", message: Object.values(toFieldErrors(parsed.error))[0] ?? "Check the form." };
  const { data, error } = await supabase.rpc("create_contract_invoice", {
    p_assignment_id: assignmentId,
    p_timesheet_ids: parsed.data.ids,
    p_issue_date: parsed.data.issueDate,
    p_due_date: parsed.data.dueDate,
  });
  if (error || !data) return { status: "error", message: error ? dbMessage(error, "The invoice could not be created.") : "The invoice could not be created." };
  refresh(assignmentId);
  redirect(`/recruiter/finance/invoices/${data as string}`);
}
