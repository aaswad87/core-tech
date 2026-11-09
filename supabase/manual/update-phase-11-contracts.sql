-- CoreTech Phase 11 update (contract staffing). Run once in the Supabase SQL editor, after the Phase 9 and Phase 10 updates.

-- Phase 11: contract staffing foundation.
--
-- Models contract assignments (worker, client, dates, bill and pay rates), weekly timesheets with client
-- approval, invoices built from approved timesheets, and payroll *status tracking*.
--
-- This is NOT a payroll system. Nothing here pays workers, withholds taxes or files anything. Payroll
-- status only records what an external payroll provider did. Live contract payroll needs a verified
-- provider plus employment, insurance, legal and funding review before it is used for real workers.
--
-- Per timesheet the money is kept in separate, explicit figures (rates are snapshotted when entered):
--   billing     = hours × bill rate (overtime × multiplier)  — what the client owes
--   gross pay   = hours × pay rate (overtime × multiplier)   — what the worker earns before deductions
--   spread      = billing − gross pay                       — gross margin
--   burden      = gross pay × estimated burden %            — ESTIMATED employer taxes/insurance
--   net margin  = spread − burden
--
-- Access: administrators manage everything. Employers see and approve/reject timesheets for their own
-- company's assignments (hours and billing only — never pay rate, burden or margin). Recruiters, other
-- employers and candidates see nothing here.

create type public.assignment_status as enum ('pending', 'active', 'ended', 'cancelled');
create type public.employment_model as enum ('w2_payroll_provider', 'c2c', '1099');
create type public.timesheet_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.payroll_status as enum ('not_ready', 'ready', 'sent_to_provider', 'paid_by_provider');

create table public.contract_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  company_id uuid not null references public.companies (id),
  job_id uuid references public.jobs (id) on delete set null,
  title text not null check (char_length(title) between 2 and 200),
  status public.assignment_status not null default 'pending',
  employment_model public.employment_model not null,
  start_date date not null,
  end_date date,
  bill_rate numeric(10, 2) not null check (bill_rate > 0 and bill_rate <= 2000),
  pay_rate numeric(10, 2) not null check (pay_rate > 0 and pay_rate <= 2000),
  ot_bill_multiplier numeric(4, 2) not null default 1.5 check (ot_bill_multiplier between 1 and 3),
  ot_pay_multiplier numeric(4, 2) not null default 1.5 check (ot_pay_multiplier between 1 and 3),
  -- Estimate only (employer FICA, FUTA/SUTA, workers' comp, benefits). Confirm with the payroll provider.
  burden_percent numeric(5, 2) not null default 18 check (burden_percent between 0 and 60),
  client_payment_terms_days integer not null default 30 check (client_payment_terms_days between 0 and 120),
  worker_pay_frequency text not null default 'weekly' check (worker_pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  foreign key (candidate_id, organization_id) references public.candidates (id, organization_id)
);

create index contract_assignments_org_idx on public.contract_assignments (organization_id, status, start_date desc);
create index contract_assignments_company_idx on public.contract_assignments (company_id);

-- Contract invoices are ordinary invoices tied to an assignment instead of a placement.
alter table public.invoices
  add column assignment_id uuid references public.contract_assignments (id) on delete restrict,
  add constraint invoices_has_source check (kind = 'credit_note' or placement_id is not null or assignment_id is not null);

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  assignment_id uuid not null references public.contract_assignments (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  week_start date not null check (extract(isodow from week_start) = 1),
  regular_hours numeric(5, 2) not null check (regular_hours between 0 and 80),
  overtime_hours numeric(5, 2) not null default 0 check (overtime_hours between 0 and 60),
  -- Rates copied from the assignment when the timesheet was last edited, so later rate changes
  -- don't rewrite history.
  bill_rate numeric(10, 2) not null,
  pay_rate numeric(10, 2) not null,
  ot_bill_multiplier numeric(4, 2) not null,
  ot_pay_multiplier numeric(4, 2) not null,
  burden_percent numeric(5, 2) not null,
  billing numeric(12, 2) generated always as (round(regular_hours * bill_rate + overtime_hours * bill_rate * ot_bill_multiplier, 2)) stored,
  gross_pay numeric(12, 2) generated always as (round(regular_hours * pay_rate + overtime_hours * pay_rate * ot_pay_multiplier, 2)) stored,
  status public.timesheet_status not null default 'draft',
  notes text check (notes is null or char_length(notes) <= 1000),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  submitted_at timestamptz,
  approved_at timestamptz,
  -- Who approved: a client user (employer) or CoreTech staff recording the client's approval.
  approved_by uuid references public.profiles (id) on delete set null,
  approved_by_kind text check (approved_by_kind is null or approved_by_kind in ('client', 'staff')),
  approval_note text check (approval_note is null or char_length(approval_note) <= 500),
  invoice_id uuid references public.invoices (id) on delete set null,
  payroll_status public.payroll_status not null default 'not_ready',
  payroll_reference text check (payroll_reference is null or char_length(payroll_reference) <= 200),
  payroll_updated_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, week_start),
  check (regular_hours + overtime_hours > 0),
  check (status <> 'approved' or approved_at is not null)
);

create index timesheets_assignment_idx on public.timesheets (assignment_id, week_start desc);
create index timesheets_company_status_idx on public.timesheets (company_id, status);
create index timesheets_invoice_idx on public.timesheets (invoice_id);

-- A voided contract invoice releases its timesheets so they can be invoiced again.
create function private.release_voided_timesheets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.timesheets set invoice_id = null, updated_at = now() where invoice_id = new.id;
  end if;
  return null;
end;
$$;

create trigger invoices_release_timesheets
  after update of status on public.invoices
  for each row execute function private.release_voided_timesheets();

-- ---------------------------------------------------------------------------
-- Assignments (admin)
-- ---------------------------------------------------------------------------

create function public.save_assignment(
  p_assignment_id uuid,
  p_candidate_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_title text,
  p_employment_model public.employment_model,
  p_start_date date,
  p_end_date date,
  p_bill_rate numeric,
  p_pay_rate numeric,
  p_ot_bill_multiplier numeric,
  p_ot_pay_multiplier numeric,
  p_burden_percent numeric,
  p_client_payment_terms_days integer,
  p_worker_pay_frequency text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid := p_assignment_id;
begin
  select organization_id into v_org from public.candidates where id = p_candidate_id;
  if v_org is null then
    raise exception 'Worker not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_org);
  if not exists (select 1 from public.companies where id = p_company_id and organization_id = v_org) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if p_job_id is not null and not exists (select 1 from public.jobs where id = p_job_id and company_id = p_company_id) then
    raise exception 'That job belongs to a different client' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.contract_assignments (
      organization_id, candidate_id, company_id, job_id, title, employment_model, start_date, end_date, bill_rate, pay_rate,
      ot_bill_multiplier, ot_pay_multiplier, burden_percent, client_payment_terms_days, worker_pay_frequency, notes, created_by
    ) values (
      v_org, p_candidate_id, p_company_id, p_job_id, btrim(coalesce(p_title, '')), p_employment_model, p_start_date, p_end_date,
      p_bill_rate, p_pay_rate, coalesce(p_ot_bill_multiplier, 1.5), coalesce(p_ot_pay_multiplier, 1.5), coalesce(p_burden_percent, 18),
      coalesce(p_client_payment_terms_days, 30), coalesce(p_worker_pay_frequency, 'weekly'), nullif(btrim(coalesce(p_notes, '')), ''),
      (select auth.uid())
    )
    returning id into v_id;
    perform private.write_audit(v_org, 'assignment.created', 'assignment', v_id::text, jsonb_build_object('bill', p_bill_rate, 'pay', p_pay_rate));
  else
    update public.contract_assignments
    set candidate_id = p_candidate_id, company_id = p_company_id, job_id = p_job_id, title = btrim(coalesce(p_title, '')),
        employment_model = p_employment_model, start_date = p_start_date, end_date = p_end_date,
        bill_rate = p_bill_rate, pay_rate = p_pay_rate,
        ot_bill_multiplier = coalesce(p_ot_bill_multiplier, 1.5), ot_pay_multiplier = coalesce(p_ot_pay_multiplier, 1.5),
        burden_percent = coalesce(p_burden_percent, 18), client_payment_terms_days = coalesce(p_client_payment_terms_days, 30),
        worker_pay_frequency = coalesce(p_worker_pay_frequency, 'weekly'), notes = nullif(btrim(coalesce(p_notes, '')), ''),
        updated_at = now()
    where id = v_id and organization_id = v_org and status in ('pending', 'active');
    if not found then
      raise exception 'Only pending or active assignments can be edited' using errcode = '22023';
    end if;
    if exists (select 1 from public.timesheets t where t.assignment_id = v_id and t.company_id <> p_company_id) then
      raise exception 'The client can''t change once timesheets exist' using errcode = '22023';
    end if;
    perform private.write_audit(v_org, 'assignment.updated', 'assignment', v_id::text, jsonb_build_object('bill', p_bill_rate, 'pay', p_pay_rate));
  end if;
  return v_id;
end;
$$;

create function public.set_assignment_status(p_assignment_id uuid, p_status public.assignment_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.contract_assignments;
begin
  select * into v_a from public.contract_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_a.organization_id);
  if not (
    (v_a.status = 'pending' and p_status in ('active', 'cancelled'))
    or (v_a.status = 'active' and p_status = 'ended')
  ) then
    raise exception 'An assignment can''t move from % to %', v_a.status, p_status using errcode = '22023';
  end if;
  update public.contract_assignments
  set status = p_status,
      end_date = case when p_status = 'ended' then coalesce(end_date, current_date) else end_date end,
      updated_at = now()
  where id = p_assignment_id;
  perform private.write_audit(v_a.organization_id, 'assignment.status_changed', 'assignment', p_assignment_id::text,
    jsonb_build_object('from', v_a.status, 'to', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Timesheets
-- ---------------------------------------------------------------------------

-- Admin enters or corrects a week (draft / rejected / submitted). Rates are re-copied from the assignment.
create function public.save_timesheet(
  p_assignment_id uuid,
  p_week_start date,
  p_regular_hours numeric,
  p_overtime_hours numeric,
  p_notes text,
  p_submit boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.contract_assignments;
  v_existing public.timesheets;
  v_id uuid;
  v_status public.timesheet_status := case when coalesce(p_submit, false) then 'submitted' else 'draft' end;
begin
  select * into v_a from public.contract_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_a.organization_id);
  if v_a.status not in ('active', 'ended') then
    raise exception 'Timesheets need an active (or ended) assignment' using errcode = '22023';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Weeks start on Monday' using errcode = '22023';
  end if;
  if p_week_start + 6 < v_a.start_date or (v_a.end_date is not null and p_week_start > v_a.end_date) then
    raise exception 'That week is outside the assignment dates' using errcode = '22023';
  end if;
  if p_week_start > current_date then
    raise exception 'That week hasn''t started yet' using errcode = '22023';
  end if;

  select * into v_existing from public.timesheets where assignment_id = p_assignment_id and week_start = p_week_start for update;
  if found and v_existing.status = 'approved' then
    raise exception 'This week is already approved' using errcode = '22023';
  end if;

  insert into public.timesheets (
    organization_id, assignment_id, company_id, week_start, regular_hours, overtime_hours, bill_rate, pay_rate,
    ot_bill_multiplier, ot_pay_multiplier, burden_percent, status, notes, submitted_at, created_by
  ) values (
    v_a.organization_id, p_assignment_id, v_a.company_id, p_week_start, coalesce(p_regular_hours, 0), coalesce(p_overtime_hours, 0),
    v_a.bill_rate, v_a.pay_rate, v_a.ot_bill_multiplier, v_a.ot_pay_multiplier, v_a.burden_percent, v_status,
    nullif(btrim(coalesce(p_notes, '')), ''), case when v_status = 'submitted' then now() end, (select auth.uid())
  )
  on conflict (assignment_id, week_start) do update
    set regular_hours = excluded.regular_hours, overtime_hours = excluded.overtime_hours,
        bill_rate = excluded.bill_rate, pay_rate = excluded.pay_rate,
        ot_bill_multiplier = excluded.ot_bill_multiplier, ot_pay_multiplier = excluded.ot_pay_multiplier,
        burden_percent = excluded.burden_percent, status = excluded.status, notes = excluded.notes,
        submitted_at = excluded.submitted_at, rejection_reason = null, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Client (an employer member of the assignment's company) or an admin recording the client's approval.
create function public.review_timesheet(p_timesheet_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.timesheets;
  v_kind text;
begin
  select * into v_t from public.timesheets where id = p_timesheet_id for update;
  if not found then
    raise exception 'Timesheet not found' using errcode = 'P0002';
  end if;
  if private.is_company_member(v_t.company_id) then
    v_kind := 'client';
  elsif private.is_admin(v_t.organization_id) then
    v_kind := 'staff';
  else
    raise exception 'Timesheet not found' using errcode = 'P0002';
  end if;
  if v_t.status <> 'submitted' then
    raise exception 'Only submitted timesheets can be approved or rejected' using errcode = '22023';
  end if;
  if not coalesce(p_approve, false) and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say what needs to change' using errcode = '22023';
  end if;
  if coalesce(p_approve, false) and v_kind = 'staff' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Note how the client approved (e.g. "Approved by J. Lee by email, Nov 8")' using errcode = '22023';
  end if;

  if coalesce(p_approve, false) then
    update public.timesheets
    set status = 'approved', approved_at = now(), approved_by = (select auth.uid()), approved_by_kind = v_kind,
        approval_note = nullif(btrim(coalesce(p_note, '')), ''), payroll_status = 'ready', payroll_updated_at = now(), updated_at = now()
    where id = p_timesheet_id;
  else
    update public.timesheets set status = 'rejected', rejection_reason = btrim(p_note), updated_at = now() where id = p_timesheet_id;
  end if;
  perform private.write_audit(v_t.organization_id, case when p_approve then 'timesheet.approved' else 'timesheet.rejected' end,
    'timesheet', p_timesheet_id::text, jsonb_build_object('by', v_kind));
end;
$$;

-- Tracking only: records what the external payroll provider did. It never pays anyone.
create function public.set_payroll_status(p_timesheet_id uuid, p_status public.payroll_status, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.timesheets;
begin
  select * into v_t from public.timesheets where id = p_timesheet_id for update;
  if not found then
    raise exception 'Timesheet not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_t.organization_id);
  if v_t.status <> 'approved' then
    raise exception 'Only approved timesheets go to payroll' using errcode = '22023';
  end if;
  if p_status not in ('ready', 'sent_to_provider', 'paid_by_provider') then
    raise exception 'Choose ready, sent to provider or paid by provider' using errcode = '22023';
  end if;
  if p_status = 'paid_by_provider' and btrim(coalesce(p_reference, '')) = '' then
    raise exception 'Enter the payroll provider''s reference (run or check number)' using errcode = '22023';
  end if;
  update public.timesheets
  set payroll_status = p_status, payroll_reference = nullif(btrim(coalesce(p_reference, '')), ''), payroll_updated_at = now(), updated_at = now()
  where id = p_timesheet_id;
  perform private.write_audit(v_t.organization_id, 'timesheet.payroll_status', 'timesheet', p_timesheet_id::text,
    jsonb_build_object('status', p_status, 'reference', p_reference));
end;
$$;

-- Bills approved, not-yet-invoiced weeks of one assignment as a single draft invoice.
create function public.create_contract_invoice(p_assignment_id uuid, p_timesheet_ids uuid[], p_issue_date date, p_due_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.contract_assignments;
  v_count integer;
  v_total numeric;
  v_first date;
  v_last date;
  v_id uuid;
  v_number text;
begin
  select * into v_a from public.contract_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_a.organization_id);
  if p_timesheet_ids is null or cardinality(p_timesheet_ids) = 0 then
    raise exception 'Choose at least one approved week' using errcode = '22023';
  end if;

  perform 1 from public.timesheets where id = any (p_timesheet_ids) for update;
  select count(*), sum(billing), min(week_start), max(week_start) into v_count, v_total, v_first, v_last
  from public.timesheets
  where id = any (p_timesheet_ids) and assignment_id = p_assignment_id and status = 'approved' and invoice_id is null;
  if v_count <> cardinality(p_timesheet_ids) then
    raise exception 'Every week must be approved, belong to this assignment and not be invoiced yet' using errcode = '22023';
  end if;

  v_number := 'INV-' || to_char(coalesce(p_issue_date, current_date), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
  insert into public.invoices (organization_id, company_id, assignment_id, kind, invoice_number, issue_date, due_date, amount, description, created_by)
  values (
    v_a.organization_id, v_a.company_id, p_assignment_id, 'invoice', v_number, p_issue_date, p_due_date, v_total,
    left(format('Contract services — %s, weeks of %s to %s (%s week%s)', v_a.title, v_first, v_last, v_count, case when v_count = 1 then '' else 's' end), 1000),
    (select auth.uid())
  )
  returning id into v_id;

  update public.timesheets set invoice_id = v_id, updated_at = now() where id = any (p_timesheet_ids);
  perform private.write_audit(v_a.organization_id, 'invoice.created', 'invoice', v_id::text,
    jsonb_build_object('number', v_number, 'assignment_id', p_assignment_id, 'weeks', v_count, 'amount', v_total));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------

-- Per-assignment money and cash-flow exposure (admin). Exposure = worker pay plus estimated burden on
-- approved weeks whose client invoice hasn't been paid — money CoreTech fronts before the client pays.
create function public.contract_overview()
returns table (
  assignment_id uuid, title text, worker_name text, company_name text, status public.assignment_status,
  employment_model public.employment_model, bill_rate numeric, pay_rate numeric, burden_percent numeric,
  client_payment_terms_days integer, worker_pay_frequency text, start_date date, end_date date,
  approved_hours numeric, billing numeric, gross_pay numeric, spread numeric, est_burden numeric, net_margin numeric,
  uninvoiced_billing numeric, unpaid_invoiced numeric, exposure numeric, pending_approval integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.my_org();
begin
  perform private.require_admin(v_org);
  return query
  select a.id, a.title, c.first_name || ' ' || c.last_name, co.name, a.status, a.employment_model,
         a.bill_rate, a.pay_rate, a.burden_percent, a.client_payment_terms_days, a.worker_pay_frequency, a.start_date, a.end_date,
         coalesce(sum(t.regular_hours + t.overtime_hours) filter (where t.status = 'approved'), 0),
         coalesce(sum(t.billing) filter (where t.status = 'approved'), 0),
         coalesce(sum(t.gross_pay) filter (where t.status = 'approved'), 0),
         coalesce(sum(t.billing - t.gross_pay) filter (where t.status = 'approved'), 0),
         coalesce(round(sum(t.gross_pay * t.burden_percent / 100) filter (where t.status = 'approved'), 2), 0),
         coalesce(round(sum(t.billing - t.gross_pay - t.gross_pay * t.burden_percent / 100) filter (where t.status = 'approved'), 2), 0),
         coalesce(sum(t.billing) filter (where t.status = 'approved' and t.invoice_id is null), 0),
         coalesce((select sum(i.amount - private.invoice_paid(i.id)) from public.invoices i
                   where i.assignment_id = a.id and i.status in ('sent', 'partially_paid', 'draft')), 0),
         coalesce(round(sum(t.gross_pay * (1 + t.burden_percent / 100)) filter (
           where t.status = 'approved'
             and (t.invoice_id is null or exists (select 1 from public.invoices i where i.id = t.invoice_id and i.status <> 'paid'))
         ), 2), 0),
         (count(*) filter (where t.status = 'submitted'))::integer
  from public.contract_assignments a
  join public.candidates c on c.id = a.candidate_id
  join public.companies co on co.id = a.company_id
  left join public.timesheets t on t.assignment_id = a.id
  where a.organization_id = v_org
  group by a.id, c.first_name, c.last_name, co.name
  order by a.status, a.start_date desc;
end;
$$;

-- What a client sees: their company's weeks with hours and billing only.
create function public.company_timesheets(p_company_id uuid)
returns table (
  id uuid, assignment_title text, worker_name text, week_start date, regular_hours numeric, overtime_hours numeric,
  bill_rate numeric, ot_bill_multiplier numeric, billing numeric, status public.timesheet_status, notes text,
  rejection_reason text, approved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, a.title, c.first_name || ' ' || left(c.last_name, 1) || '.', t.week_start, t.regular_hours, t.overtime_hours,
         t.bill_rate, t.ot_bill_multiplier, t.billing, t.status, t.notes, t.rejection_reason, t.approved_at
  from public.timesheets t
  join public.contract_assignments a on a.id = t.assignment_id
  join public.candidates c on c.id = a.candidate_id
  where t.company_id = p_company_id
    and t.status <> 'draft'
    and private.is_company_member(p_company_id)
  order by t.week_start desc, a.title;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.contract_assignments enable row level security;
alter table public.timesheets enable row level security;

create policy "Admins can view assignments" on public.contract_assignments for select to authenticated
  using ((select private.is_admin(organization_id)));
create policy "Admins can view timesheets" on public.timesheets for select to authenticated
  using ((select private.is_admin(organization_id)));

revoke all on public.contract_assignments, public.timesheets from anon, authenticated;
grant select on public.contract_assignments, public.timesheets to authenticated;

revoke all on function
  private.release_voided_timesheets(),
  public.save_assignment(uuid, uuid, uuid, uuid, text, public.employment_model, date, date, numeric, numeric, numeric, numeric, numeric, integer, text, text),
  public.set_assignment_status(uuid, public.assignment_status),
  public.save_timesheet(uuid, date, numeric, numeric, text, boolean),
  public.review_timesheet(uuid, boolean, text),
  public.set_payroll_status(uuid, public.payroll_status, text),
  public.create_contract_invoice(uuid, uuid[], date, date),
  public.contract_overview(),
  public.company_timesheets(uuid)
  from public, anon, authenticated;

grant execute on function
  public.save_assignment(uuid, uuid, uuid, uuid, text, public.employment_model, date, date, numeric, numeric, numeric, numeric, numeric, integer, text, text),
  public.set_assignment_status(uuid, public.assignment_status),
  public.save_timesheet(uuid, date, numeric, numeric, text, boolean),
  public.review_timesheet(uuid, boolean, text),
  public.set_payroll_status(uuid, public.payroll_status, text),
  public.create_contract_invoice(uuid, uuid[], date, date),
  public.contract_overview(),
  public.company_timesheets(uuid)
  to authenticated;
