import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ContractOverviewRow = {
  assignment_id: string;
  title: string;
  worker_name: string;
  company_name: string;
  status: string;
  employment_model: string;
  bill_rate: number;
  pay_rate: number;
  burden_percent: number;
  client_payment_terms_days: number;
  worker_pay_frequency: string;
  start_date: string;
  end_date: string | null;
  approved_hours: number;
  billing: number;
  gross_pay: number;
  spread: number;
  est_burden: number;
  net_margin: number;
  uninvoiced_billing: number;
  unpaid_invoiced: number;
  exposure: number;
  pending_approval: number;
};

const NUMERIC: (keyof ContractOverviewRow)[] = [
  "bill_rate", "pay_rate", "burden_percent", "approved_hours", "billing", "gross_pay", "spread", "est_burden",
  "net_margin", "uninvoiced_billing", "unpaid_invoiced", "exposure",
];

export async function getContractOverview() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contract_overview");
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const out = { ...r } as Record<string, unknown>;
    for (const k of NUMERIC) out[k] = Number(r[k] ?? 0);
    return out as ContractOverviewRow;
  });
  return { rows, error: Boolean(error) };
}

export type AssignmentRow = {
  id: string;
  candidate_id: string;
  company_id: string;
  job_id: string | null;
  title: string;
  status: string;
  employment_model: string;
  start_date: string;
  end_date: string | null;
  bill_rate: number;
  pay_rate: number;
  ot_bill_multiplier: number;
  ot_pay_multiplier: number;
  burden_percent: number;
  client_payment_terms_days: number;
  worker_pay_frequency: string;
  notes: string | null;
  candidates: { first_name: string; last_name: string } | null;
  companies: { name: string } | null;
};

export type TimesheetRow = {
  id: string;
  week_start: string;
  regular_hours: number;
  overtime_hours: number;
  bill_rate: number;
  pay_rate: number;
  burden_percent: number;
  billing: number;
  gross_pay: number;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by_kind: string | null;
  approval_note: string | null;
  invoice_id: string | null;
  payroll_status: string;
  payroll_reference: string | null;
  invoices: { invoice_number: string; status: string } | null;
};

export async function getAssignment(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contract_assignments")
    .select("id, candidate_id, company_id, job_id, title, status, employment_model, start_date, end_date, bill_rate, pay_rate, ot_bill_multiplier, ot_pay_multiplier, burden_percent, client_payment_terms_days, worker_pay_frequency, notes, candidates(first_name, last_name), companies(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [timesheets, overview] = await Promise.all([
    supabase
      .from("timesheets")
      .select("id, week_start, regular_hours, overtime_hours, bill_rate, pay_rate, burden_percent, billing, gross_pay, status, notes, rejection_reason, approved_at, approved_by_kind, approval_note, invoice_id, payroll_status, payroll_reference, invoices(invoice_number, status)")
      .eq("assignment_id", id)
      .order("week_start", { ascending: false }),
    getContractOverview(),
  ]);
  return {
    assignment: data as unknown as AssignmentRow,
    timesheets: (timesheets.data ?? []) as unknown as TimesheetRow[],
    totals: overview.rows.find((r) => r.assignment_id === id) ?? null,
  };
}

/** Pickers for the assignment form. */
export async function getAssignmentOptions() {
  const supabase = await createClient();
  const [candidates, companies] = await Promise.all([
    supabase.from("candidates").select("id, first_name, last_name").order("last_name").order("first_name").limit(1000),
    supabase.from("companies").select("id, name").order("name").limit(500),
  ]);
  return {
    workers: ((candidates.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}` })),
    clients: ((companies.data ?? []) as { id: string; name: string }[]).map((c) => ({ value: c.id, label: c.name })),
  };
}

export type ClientTimesheet = {
  id: string;
  assignment_title: string;
  worker_name: string;
  week_start: string;
  regular_hours: number;
  overtime_hours: number;
  bill_rate: number;
  ot_bill_multiplier: number;
  billing: number;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
};

export async function listClientTimesheets(companyId: string): Promise<ClientTimesheet[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("company_timesheets", { p_company_id: companyId });
  return (data ?? []) as ClientTimesheet[];
}
