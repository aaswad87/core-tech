import "server-only";

import { createClient } from "@/lib/supabase/server";

export type Summary = {
  forecast: number;
  earned: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  at_risk: number;
  refunds_owed: number;
};

export type PlacementRow = {
  id: string;
  application_id: string;
  candidate_id: string;
  status: string;
  offer_accepted_on: string;
  start_date: string;
  base_salary: number;
  fee_type: string;
  fee_percent: number | null;
  fee_flat: number | null;
  fee_amount: number;
  guarantee_days: number;
  guarantee_ends_on: string;
  fell_off_on: string | null;
  falloff_reason: string | null;
  resolution: string | null;
  refund_amount: number;
  replacement_placement_id: string | null;
  notes: string | null;
  candidates: { first_name: string; last_name: string } | null;
  jobs: { title: string } | null;
  companies: { id: string; name: string } | null;
};

export type InvoiceRow = {
  id: string;
  placement_id: string | null;
  kind: string;
  credits_invoice_id: string | null;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  amount: number;
  description: string;
  sent_at: string | null;
  void_reason: string | null;
  companies: { name: string } | null;
};

const PLACEMENT_SELECT =
  "id, application_id, candidate_id, status, offer_accepted_on, start_date, base_salary, fee_type, fee_percent, fee_flat, fee_amount, guarantee_days, guarantee_ends_on, fell_off_on, falloff_reason, resolution, refund_amount, replacement_placement_id, notes, candidates(first_name, last_name), jobs(title), companies(id, name)";
const INVOICE_SELECT =
  "id, placement_id, kind, credits_invoice_id, invoice_number, status, issue_date, due_date, amount, description, sent_at, void_reason, companies(name)";

export async function getFinanceOverview(from: string, to: string) {
  const supabase = await createClient();
  const [summary, placements, invoices, payments] = await Promise.all([
    supabase.rpc("finance_summary", { p_from: from, p_to: to }),
    supabase.from("placements").select(PLACEMENT_SELECT).order("start_date", { ascending: false }).limit(200),
    supabase.from("invoices").select(INVOICE_SELECT).order("issue_date", { ascending: false }).limit(200),
    supabase.from("payments").select("invoice_id, amount"),
  ]);
  const raw = (summary.data as Record<string, unknown>[] | null)?.[0] ?? {};
  const paid = new Map<string, number>();
  for (const p of (payments.data ?? []) as { invoice_id: string; amount: number }[]) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount));
  return {
    summary: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)])) as Summary,
    summaryError: Boolean(summary.error),
    placements: (placements.data ?? []) as unknown as PlacementRow[],
    invoices: (invoices.data ?? []) as unknown as InvoiceRow[],
    paid,
  };
}

export async function getPlacement(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("placements").select(PLACEMENT_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const placement = data as unknown as PlacementRow;
  const [invoices, commissions, staff, siblings] = await Promise.all([
    supabase.from("invoices").select(INVOICE_SELECT).eq("placement_id", id).order("issue_date"),
    supabase.rpc("commission_overview"),
    supabase.from("user_roles").select("user_id, role, profiles(full_name, email)").in("role", ["admin", "recruiter"]),
    supabase
      .from("placements")
      .select("id, start_date, candidates(first_name, last_name)")
      .eq("company_id", placement.companies?.id ?? "")
      .neq("id", id)
      .order("start_date", { ascending: false })
      .limit(50),
  ]);
  const invoiceIds = ((invoices.data ?? []) as { id: string }[]).map((i) => i.id);
  const { data: payments } = invoiceIds.length
    ? await supabase.from("payments").select("id, invoice_id, amount, received_on, method, reference").in("invoice_id", invoiceIds).order("received_on")
    : { data: [] };

  const people = new Map<string, string>();
  for (const r of (staff.data ?? []) as unknown as { user_id: string; profiles: { full_name: string | null; email: string } | null }[]) {
    people.set(r.user_id, r.profiles?.full_name ?? r.profiles?.email ?? "Staff member");
  }

  return {
    placement,
    invoices: (invoices.data ?? []) as unknown as InvoiceRow[],
    payments: (payments ?? []) as { id: string; invoice_id: string; amount: number; received_on: string; method: string; reference: string | null }[],
    commissions: ((commissions.data ?? []) as CommissionRow[]).filter((c) => c.placement_id === id),
    staff: [...people].map(([id, name]) => ({ value: id, label: name })).sort((a, b) => a.label.localeCompare(b.label)),
    otherPlacements: (siblings.data ?? []) as unknown as { id: string; start_date: string; candidates: { first_name: string; last_name: string } | null }[],
  };
}

export async function getInvoice(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      `${INVOICE_SELECT}, organization_id, assignment_id, companies(name, website, headquarters), placements(start_date, base_salary, fee_type, fee_percent, candidates(first_name, last_name), jobs(title)), timesheets(id, week_start, regular_hours, overtime_hours, bill_rate, ot_bill_multiplier, billing)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [{ data: payments }, { data: credits }, { data: original }] = await Promise.all([
    supabase.from("payments").select("id, amount, received_on, method, reference").eq("invoice_id", id).order("received_on"),
    supabase.from("invoices").select("id, invoice_number, amount, status").eq("credits_invoice_id", id),
    data.credits_invoice_id
      ? supabase.from("invoices").select("id, invoice_number").eq("id", data.credits_invoice_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    invoice: data as unknown as InvoiceRow & {
      assignment_id: string | null;
      timesheets: { id: string; week_start: string; regular_hours: number; overtime_hours: number; bill_rate: number; ot_bill_multiplier: number; billing: number }[];
      companies: { name: string; website: string | null; headquarters: string | null } | null;
      placements: { start_date: string; base_salary: number; fee_type: string; fee_percent: number | null; candidates: { first_name: string; last_name: string } | null; jobs: { title: string } | null } | null;
    },
    payments: (payments ?? []) as { id: string; amount: number; received_on: string; method: string; reference: string | null }[],
    credits: (credits ?? []) as { id: string; invoice_number: string; amount: number; status: string }[],
    original: original as { id: string; invoice_number: string } | null,
  };
}

export type CommissionRow = {
  id: string;
  placement_id: string;
  recruiter_id: string;
  recruiter_name: string;
  candidate_name: string;
  company_name: string;
  start_date: string;
  fee_amount: number;
  split_percent: number;
  rate_percent: number;
  amount: number;
  status: string;
  paid_on: string | null;
  paid_amount: number | null;
};

export async function listCommissions(): Promise<CommissionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("commission_overview");
  return (data ?? []) as CommissionRow[];
}

/** Applications at Offer or Placed without a placement yet, for the "record a placement" prompt. */
export async function listPlacementCandidates() {
  const supabase = await createClient();
  const [{ data: apps }, { data: existing }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, stage, candidates(first_name, last_name), jobs(title, companies(name))")
      .in("stage", ["offer", "placed"])
      .order("stage_changed_at", { ascending: false })
      .limit(100),
    supabase.from("placements").select("application_id"),
  ]);
  const taken = new Set(((existing ?? []) as { application_id: string }[]).map((p) => p.application_id));
  return ((apps ?? []) as unknown as {
    id: string;
    stage: string;
    candidates: { first_name: string; last_name: string } | null;
    jobs: { title: string; companies: { name: string } | null } | null;
  }[]).filter((a) => !taken.has(a.id));
}

export async function getApplicationForPlacement(applicationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id, stage, candidates(id, first_name, last_name), jobs(title, salary_min, salary_max, companies(name))")
    .eq("id", applicationId)
    .maybeSingle();
  return data as unknown as {
    id: string;
    stage: string;
    candidates: { id: string; first_name: string; last_name: string } | null;
    jobs: { title: string; salary_min: number | null; salary_max: number | null; companies: { name: string } | null } | null;
  } | null;
}
