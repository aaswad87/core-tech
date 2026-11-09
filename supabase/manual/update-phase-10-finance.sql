-- CoreTech Phase 10 update (direct-hire finance). Run once in the Supabase SQL editor, after the Phase 9 update.

-- Phase 10: direct-hire finance.
--
--   * placements: one per hired application — salary basis, agreed fee (percentage of base salary or a
--     flat amount), start date, guarantee period, and fall-off with replacement / refund tracking.
--   * invoices (and credit notes) with numbering, sent / void status; payments reconcile against them.
--   * commissions: recruiter splits on a placement's fee, with a computed status.
--
-- Amounts are kept in four clearly separate buckets (finance_summary):
--   forecast  = fees on accepted offers that haven't started yet (not money yet)
--   earned    = fees on placements that have started, less refunds owed for fall-offs
--   invoiced  = invoices sent (not drafts or voided), less credit notes
--   collected = payments received, less refunds paid out on credit notes
--
-- Access: administrators manage and see all finance data. Recruiters only see placements they are
-- credited on and their own commissions (read-only). Employers and candidates see nothing. Every write
-- goes through an admin-only SECURITY DEFINER function and is written to the audit log.

create type public.placement_status as enum ('pending_start', 'started', 'fell_off', 'cancelled');
create type public.fee_type as enum ('percentage', 'flat');
create type public.falloff_resolution as enum ('replacement', 'refund', 'partial_refund', 'none');
create type public.invoice_kind as enum ('invoice', 'credit_note');
create type public.invoice_status as enum ('draft', 'sent', 'partially_paid', 'paid', 'void');
create type public.payment_method as enum ('ach', 'wire', 'check', 'card', 'other');

-- ---------------------------------------------------------------------------
-- Placements
-- ---------------------------------------------------------------------------

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  application_id uuid not null unique,
  candidate_id uuid not null,
  job_id uuid not null,
  company_id uuid not null references public.companies (id),
  status public.placement_status not null default 'pending_start',
  offer_accepted_on date not null,
  start_date date not null,
  base_salary numeric(12, 2) not null check (base_salary > 0 and base_salary <= 10000000),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  fee_type public.fee_type not null,
  fee_percent numeric(5, 2) check (fee_percent is null or (fee_percent > 0 and fee_percent <= 100)),
  fee_flat numeric(12, 2) check (fee_flat is null or (fee_flat > 0 and fee_flat <= 10000000)),
  fee_amount numeric(12, 2) generated always as (
    case when fee_type = 'percentage' then round(base_salary * fee_percent / 100, 2) else fee_flat end
  ) stored,
  guarantee_days integer not null default 90 check (guarantee_days between 0 and 365),
  guarantee_ends_on date generated always as (start_date + guarantee_days) stored,
  fell_off_on date,
  falloff_reason text check (falloff_reason is null or char_length(falloff_reason) <= 1000),
  resolution public.falloff_resolution,
  refund_amount numeric(12, 2) not null default 0 check (refund_amount >= 0),
  replacement_placement_id uuid references public.placements (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((fee_type = 'percentage' and fee_percent is not null and fee_flat is null)
      or (fee_type = 'flat' and fee_flat is not null and fee_percent is null)),
  check (start_date >= offer_accepted_on),
  check (status <> 'fell_off' or (fell_off_on is not null and resolution is not null)),
  check (resolution in ('refund', 'partial_refund') or refund_amount = 0),
  foreign key (application_id, organization_id) references public.applications (id, organization_id),
  unique (id, organization_id)
);

create index placements_org_start_idx on public.placements (organization_id, start_date desc);
create index placements_company_idx on public.placements (company_id);

-- ---------------------------------------------------------------------------
-- Commissions
-- ---------------------------------------------------------------------------

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  placement_id uuid not null references public.placements (id) on delete cascade,
  recruiter_id uuid not null references public.profiles (id),
  split_percent numeric(5, 2) not null check (split_percent > 0 and split_percent <= 100),
  rate_percent numeric(5, 2) not null check (rate_percent > 0 and rate_percent <= 100),
  paid_on date,
  paid_amount numeric(12, 2) check (paid_amount is null or paid_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (placement_id, recruiter_id),
  check ((paid_on is null) = (paid_amount is null))
);

create index commissions_recruiter_idx on public.commissions (recruiter_id);

-- ---------------------------------------------------------------------------
-- Invoices and payments
-- ---------------------------------------------------------------------------

create sequence public.invoice_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null references public.companies (id),
  placement_id uuid references public.placements (id) on delete restrict,
  kind public.invoice_kind not null default 'invoice',
  -- For credit notes: the invoice being credited.
  credits_invoice_id uuid references public.invoices (id) on delete restrict,
  invoice_number text not null unique,
  status public.invoice_status not null default 'draft',
  issue_date date not null,
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  description text not null check (char_length(description) between 1 and 1000),
  sent_at timestamptz,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= issue_date),
  check (kind = 'invoice' or credits_invoice_id is not null)
);

create index invoices_org_issue_idx on public.invoices (organization_id, issue_date desc);
create index invoices_placement_idx on public.invoices (placement_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  received_on date not null,
  method public.payment_method not null,
  reference text check (reference is null or char_length(reference) <= 200),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id);
create index payments_org_received_idx on public.payments (organization_id, received_on desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.require_admin(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not private.is_admin(p_org) then
    raise exception 'Only administrators can manage finance records' using errcode = '42501';
  end if;
end;
$$;

create function private.my_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = (select auth.uid());
$$;

create function private.invoice_paid(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.payments where invoice_id = p_invoice_id;
$$;

-- Recomputes sent / partially_paid / paid from payments. Drafts and voided invoices are left alone.
create function private.refresh_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_paid numeric := private.invoice_paid(p_invoice_id);
begin
  select status, amount into v_inv from public.invoices where id = p_invoice_id;
  if v_inv.status in ('draft', 'void') then
    return;
  end if;
  update public.invoices
  set status = case when v_paid >= v_inv.amount then 'paid' when v_paid > 0 then 'partially_paid' else 'sent' end::public.invoice_status,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Placement functions (admin only)
-- ---------------------------------------------------------------------------

create function public.create_placement(
  p_application_id uuid,
  p_offer_accepted_on date,
  p_start_date date,
  p_base_salary numeric,
  p_fee_type public.fee_type,
  p_fee_percent numeric,
  p_fee_flat numeric,
  p_guarantee_days integer,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_id uuid;
begin
  select a.id, a.organization_id, a.candidate_id, a.job_id, a.stage, j.company_id into v_app
  from public.applications a join public.jobs j on j.id = a.job_id
  where a.id = p_application_id;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_app.organization_id);
  if v_app.stage not in ('offer', 'placed') then
    raise exception 'Record a placement once the candidate is at Offer or Placed' using errcode = '22023';
  end if;
  if exists (select 1 from public.placements where application_id = p_application_id) then
    raise exception 'This application already has a placement' using errcode = '23505';
  end if;

  insert into public.placements (
    organization_id, application_id, candidate_id, job_id, company_id, offer_accepted_on, start_date,
    base_salary, fee_type, fee_percent, fee_flat, guarantee_days, notes, created_by
  ) values (
    v_app.organization_id, p_application_id, v_app.candidate_id, v_app.job_id, v_app.company_id, p_offer_accepted_on,
    p_start_date, p_base_salary, p_fee_type,
    case when p_fee_type = 'percentage' then p_fee_percent end,
    case when p_fee_type = 'flat' then p_fee_flat end,
    coalesce(p_guarantee_days, 90), nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid())
  )
  returning id into v_id;

  perform private.write_audit(v_app.organization_id, 'placement.created', 'placement', v_id::text, jsonb_build_object('application_id', p_application_id));
  return v_id;
end;
$$;

create function public.update_placement_terms(
  p_placement_id uuid,
  p_offer_accepted_on date,
  p_start_date date,
  p_base_salary numeric,
  p_fee_type public.fee_type,
  p_fee_percent numeric,
  p_fee_flat numeric,
  p_guarantee_days integer,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.placements;
begin
  select * into v_old from public.placements where id = p_placement_id for update;
  if not found then
    raise exception 'Placement not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_old.organization_id);
  if v_old.status in ('fell_off', 'cancelled') then
    raise exception 'Closed placements can''t be edited' using errcode = '22023';
  end if;

  update public.placements
  set offer_accepted_on = p_offer_accepted_on, start_date = p_start_date, base_salary = p_base_salary,
      fee_type = p_fee_type,
      fee_percent = case when p_fee_type = 'percentage' then p_fee_percent end,
      fee_flat = case when p_fee_type = 'flat' then p_fee_flat end,
      guarantee_days = coalesce(p_guarantee_days, guarantee_days),
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
  where id = p_placement_id;

  perform private.write_audit(v_old.organization_id, 'placement.terms_changed', 'placement', p_placement_id::text,
    jsonb_build_object('old_fee', v_old.fee_amount, 'old_salary', v_old.base_salary, 'old_start', v_old.start_date));
end;
$$;

-- pending_start → started | cancelled; started → fell_off (with resolution). Statuses never go backwards.
create function public.set_placement_status(
  p_placement_id uuid,
  p_status public.placement_status,
  p_fell_off_on date,
  p_reason text,
  p_resolution public.falloff_resolution,
  p_refund_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.placements;
begin
  select * into v_old from public.placements where id = p_placement_id for update;
  if not found then
    raise exception 'Placement not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_old.organization_id);

  if not (
    (v_old.status = 'pending_start' and p_status in ('started', 'cancelled'))
    or (v_old.status = 'started' and p_status = 'fell_off')
  ) then
    raise exception 'A placement can''t move from % to %', v_old.status, p_status using errcode = '22023';
  end if;
  if p_status = 'started' and v_old.start_date > current_date then
    raise exception 'The start date hasn''t arrived yet; change the start date first if it moved' using errcode = '22023';
  end if;
  if p_status in ('fell_off', 'cancelled') and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  if p_status = 'fell_off' then
    if p_fell_off_on is null or p_fell_off_on < v_old.start_date then
      raise exception 'Enter the date the candidate left (on or after the start date)' using errcode = '22023';
    end if;
    if p_resolution is null then
      raise exception 'Choose how the fall-off is resolved' using errcode = '22023';
    end if;
    if p_resolution in ('refund', 'partial_refund') and (coalesce(p_refund_amount, 0) <= 0 or p_refund_amount > v_old.fee_amount) then
      raise exception 'Enter a refund between 0 and the fee' using errcode = '22023';
    end if;
  end if;

  update public.placements
  set status = p_status,
      fell_off_on = case when p_status = 'fell_off' then p_fell_off_on end,
      falloff_reason = case when p_status in ('fell_off', 'cancelled') then btrim(p_reason) end,
      resolution = case when p_status = 'fell_off' then p_resolution end,
      refund_amount = case when p_status = 'fell_off' and p_resolution in ('refund', 'partial_refund') then p_refund_amount else 0 end,
      updated_at = now()
  where id = p_placement_id;

  perform private.write_audit(v_old.organization_id, 'placement.status_changed', 'placement', p_placement_id::text,
    jsonb_build_object('from', v_old.status, 'to', p_status, 'resolution', p_resolution, 'refund', p_refund_amount));
end;
$$;

create function public.link_replacement(p_placement_id uuid, p_replacement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.placements;
begin
  select * into v_old from public.placements where id = p_placement_id for update;
  if not found then
    raise exception 'Placement not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_old.organization_id);
  if v_old.status <> 'fell_off' or v_old.resolution <> 'replacement' then
    raise exception 'Only a fall-off resolved by replacement can be linked' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.placements r
    where r.id = p_replacement_id and r.company_id = v_old.company_id and r.id <> p_placement_id
  ) then
    raise exception 'The replacement must be another placement with the same company' using errcode = '22023';
  end if;
  update public.placements set replacement_placement_id = p_replacement_id, updated_at = now() where id = p_placement_id;
  perform private.write_audit(v_old.organization_id, 'placement.replacement_linked', 'placement', p_placement_id::text,
    jsonb_build_object('replacement_id', p_replacement_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Commission functions (admin only)
-- ---------------------------------------------------------------------------

create function public.set_commission(p_placement_id uuid, p_recruiter_id uuid, p_split_percent numeric, p_rate_percent numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_other numeric;
begin
  select organization_id into v_org from public.placements where id = p_placement_id;
  if v_org is null then
    raise exception 'Placement not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_org);
  if not exists (
    select 1 from public.user_roles where user_id = p_recruiter_id and organization_id = v_org and role in ('admin', 'recruiter')
  ) then
    raise exception 'Commissions can only go to recruiters or administrators' using errcode = '22023';
  end if;
  select coalesce(sum(split_percent), 0) into v_other from public.commissions
  where placement_id = p_placement_id and recruiter_id <> p_recruiter_id;
  if v_other + coalesce(p_split_percent, 0) > 100 then
    raise exception 'Splits on a placement can''t add up to more than 100%%' using errcode = '22023';
  end if;
  if exists (select 1 from public.commissions where placement_id = p_placement_id and recruiter_id = p_recruiter_id and paid_on is not null) then
    raise exception 'This commission is already paid' using errcode = '22023';
  end if;

  insert into public.commissions (organization_id, placement_id, recruiter_id, split_percent, rate_percent)
  values (v_org, p_placement_id, p_recruiter_id, p_split_percent, p_rate_percent)
  on conflict (placement_id, recruiter_id) do update
    set split_percent = excluded.split_percent, rate_percent = excluded.rate_percent, updated_at = now();

  perform private.write_audit(v_org, 'commission.set', 'placement', p_placement_id::text,
    jsonb_build_object('recruiter_id', p_recruiter_id, 'split', p_split_percent, 'rate', p_rate_percent));
end;
$$;

create function public.remove_commission(p_commission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.commissions;
begin
  select * into v_c from public.commissions where id = p_commission_id;
  if not found then
    raise exception 'Commission not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_c.organization_id);
  if v_c.paid_on is not null then
    raise exception 'A paid commission can''t be removed' using errcode = '22023';
  end if;
  delete from public.commissions where id = p_commission_id;
  perform private.write_audit(v_c.organization_id, 'commission.removed', 'placement', v_c.placement_id::text, jsonb_build_object('recruiter_id', v_c.recruiter_id));
end;
$$;

create function public.mark_commission_paid(p_commission_id uuid, p_paid_on date, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.commissions;
begin
  select * into v_c from public.commissions where id = p_commission_id for update;
  if not found then
    raise exception 'Commission not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_c.organization_id);
  if v_c.paid_on is not null then
    raise exception 'Already marked paid' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > current_date or coalesce(p_amount, -1) < 0 then
    raise exception 'Enter the payout date (not in the future) and amount' using errcode = '22023';
  end if;
  update public.commissions set paid_on = p_paid_on, paid_amount = p_amount, updated_at = now() where id = p_commission_id;
  perform private.write_audit(v_c.organization_id, 'commission.paid', 'placement', v_c.placement_id::text,
    jsonb_build_object('recruiter_id', v_c.recruiter_id, 'amount', p_amount));
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoice and payment functions (admin only)
-- ---------------------------------------------------------------------------

create function public.create_invoice(
  p_placement_id uuid,
  p_kind public.invoice_kind,
  p_credits_invoice_id uuid,
  p_amount numeric,
  p_issue_date date,
  p_due_date date,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pl public.placements;
  v_credited record;
  v_id uuid;
  v_number text;
begin
  select * into v_pl from public.placements where id = p_placement_id;
  if not found then
    raise exception 'Placement not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_pl.organization_id);
  if v_pl.status = 'cancelled' then
    raise exception 'This placement was cancelled' using errcode = '22023';
  end if;

  if p_kind = 'credit_note' then
    select i.id, i.amount, i.status into v_credited from public.invoices i
    where i.id = p_credits_invoice_id and i.placement_id = p_placement_id and i.kind = 'invoice';
    if not found or v_credited.status in ('draft', 'void') then
      raise exception 'Choose a sent invoice for this placement to credit' using errcode = '22023';
    end if;
    if p_amount > v_credited.amount - coalesce((
      select sum(c.amount) from public.invoices c where c.credits_invoice_id = p_credits_invoice_id and c.status <> 'void'
    ), 0) then
      raise exception 'Credits can''t exceed the invoice amount' using errcode = '22023';
    end if;
  elsif p_credits_invoice_id is not null then
    raise exception 'Only credit notes reference another invoice' using errcode = '22023';
  end if;

  v_number := case when p_kind = 'credit_note' then 'CN-' else 'INV-' end
    || to_char(coalesce(p_issue_date, current_date), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');

  insert into public.invoices (
    organization_id, company_id, placement_id, kind, credits_invoice_id, invoice_number, issue_date, due_date,
    amount, description, created_by
  ) values (
    v_pl.organization_id, v_pl.company_id, p_placement_id, p_kind, p_credits_invoice_id, v_number, p_issue_date,
    p_due_date, p_amount, btrim(coalesce(p_description, '')), (select auth.uid())
  )
  returning id into v_id;

  perform private.write_audit(v_pl.organization_id, 'invoice.created', 'invoice', v_id::text,
    jsonb_build_object('number', v_number, 'kind', p_kind, 'amount', p_amount));
  return v_id;
end;
$$;

create function public.mark_invoice_sent(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_inv.organization_id);
  if v_inv.status <> 'draft' then
    raise exception 'Only drafts can be marked sent' using errcode = '22023';
  end if;
  update public.invoices set status = 'sent', sent_at = now(), updated_at = now() where id = p_invoice_id;
  perform private.refresh_invoice_status(p_invoice_id);
  perform private.write_audit(v_inv.organization_id, 'invoice.sent', 'invoice', p_invoice_id::text, jsonb_build_object('number', v_inv.invoice_number));
end;
$$;

create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_inv.organization_id);
  if v_inv.status = 'void' then
    raise exception 'Already void' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice_id) then
    raise exception 'Invoices with payments can''t be voided; issue a credit note instead' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  update public.invoices set status = 'void', voided_at = now(), void_reason = btrim(p_reason), updated_at = now() where id = p_invoice_id;
  perform private.write_audit(v_inv.organization_id, 'invoice.voided', 'invoice', p_invoice_id::text, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- On an invoice: money received from the client. On a credit note: a refund paid out to the client.
create function public.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_received_on date,
  p_method public.payment_method,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_id uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_inv.organization_id);
  if v_inv.status in ('draft', 'void') then
    raise exception 'Mark the invoice sent before recording payments' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > v_inv.amount - private.invoice_paid(p_invoice_id) then
    raise exception 'The amount must be more than 0 and no more than the balance due' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > current_date then
    raise exception 'Enter the date received (not in the future)' using errcode = '22023';
  end if;

  insert into public.payments (organization_id, invoice_id, amount, received_on, method, reference, recorded_by)
  values (v_inv.organization_id, p_invoice_id, p_amount, p_received_on, p_method, nullif(btrim(coalesce(p_reference, '')), ''), (select auth.uid()))
  returning id into v_id;

  perform private.refresh_invoice_status(p_invoice_id);
  perform private.write_audit(v_inv.organization_id, 'payment.recorded', 'invoice', p_invoice_id::text, jsonb_build_object('amount', p_amount, 'payment_id', v_id));
  return v_id;
end;
$$;

-- Corrects a payment entered by mistake. The audit log keeps the record.
create function public.delete_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_pay.organization_id);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  delete from public.payments where id = p_payment_id;
  perform private.refresh_invoice_status(v_pay.invoice_id);
  perform private.write_audit(v_pay.organization_id, 'payment.deleted', 'invoice', v_pay.invoice_id::text,
    jsonb_build_object('amount', v_pay.amount, 'received_on', v_pay.received_on, 'reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------

-- The four buckets for a date range, plus all-time outstanding and at-risk (in guarantee) fees.
create function public.finance_summary(p_from date, p_to date)
returns table (forecast numeric, earned numeric, invoiced numeric, collected numeric, outstanding numeric, at_risk numeric, refunds_owed numeric)
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
  select
    coalesce((select sum(p.fee_amount) from public.placements p
              where p.organization_id = v_org and p.status = 'pending_start' and p.start_date between p_from and p_to), 0),
    coalesce((select sum(p.fee_amount - p.refund_amount) from public.placements p
              where p.organization_id = v_org and p.status in ('started', 'fell_off') and p.start_date between p_from and p_to), 0),
    coalesce((select sum(case when i.kind = 'invoice' then i.amount else -i.amount end) from public.invoices i
              where i.organization_id = v_org and i.status not in ('draft', 'void') and i.issue_date between p_from and p_to), 0),
    coalesce((select sum(case when i.kind = 'invoice' then pay.amount else -pay.amount end)
              from public.payments pay join public.invoices i on i.id = pay.invoice_id
              where pay.organization_id = v_org and pay.received_on between p_from and p_to), 0),
    coalesce((select sum(i.amount - private.invoice_paid(i.id)) from public.invoices i
              where i.organization_id = v_org and i.kind = 'invoice' and i.status in ('sent', 'partially_paid')), 0),
    coalesce((select sum(p.fee_amount) from public.placements p
              where p.organization_id = v_org and p.status = 'started' and p.guarantee_ends_on >= current_date), 0),
    coalesce((select sum(p.refund_amount) from public.placements p where p.organization_id = v_org and p.status = 'fell_off'), 0)
      - coalesce((select sum(pay.amount) from public.payments pay join public.invoices i on i.id = pay.invoice_id
                  where i.organization_id = v_org and i.kind = 'credit_note'), 0);
end;
$$;

-- Commissions with amount and a derived status. Admins see everyone's; others only their own.
--   forecast    placement hasn't started
--   earned      placement started; client hasn't paid the fee in full yet
--   payable     the placement's invoices are paid in full (and no refund is owed)
--   paid        payout recorded
--   clawed_back placement fell off with a full refund before the commission was paid
--   cancelled   the placement never started
-- Amounts are on the fee net of any refund, so a partial refund reduces the commission.
create function public.commission_overview(p_recruiter_id uuid default null)
returns table (
  id uuid, placement_id uuid, recruiter_id uuid, recruiter_name text, candidate_name text, company_name text,
  start_date date, fee_amount numeric, split_percent numeric, rate_percent numeric, amount numeric,
  status text, paid_on date, paid_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with scope as (
    select c.*, p.status as placement_status, p.fee_amount, p.refund_amount, p.start_date, p.candidate_id, p.company_id
    from public.commissions c
    join public.placements p on p.id = c.placement_id
    where c.organization_id = private.my_org()
      and (
        (private.is_admin(c.organization_id) and (p_recruiter_id is null or c.recruiter_id = p_recruiter_id))
        or (c.recruiter_id = (select auth.uid()) and private.is_staff(c.organization_id))
      )
  )
  select s.id, s.placement_id, s.recruiter_id, coalesce(pr.full_name, pr.email), cand.first_name || ' ' || cand.last_name, co.name,
         s.start_date, s.fee_amount, s.split_percent, s.rate_percent,
         round((s.fee_amount - s.refund_amount) * s.split_percent / 100 * s.rate_percent / 100, 2),
         case
           when s.paid_on is not null then 'paid'
           when s.placement_status = 'cancelled' then 'cancelled'
           when s.placement_status = 'fell_off' and s.refund_amount >= s.fee_amount then 'clawed_back'
           when s.placement_status = 'pending_start' then 'forecast'
           when exists (select 1 from public.invoices i where i.placement_id = s.placement_id and i.kind = 'invoice' and i.status = 'paid')
                and not exists (select 1 from public.invoices i where i.placement_id = s.placement_id and i.kind = 'invoice' and i.status in ('sent', 'partially_paid'))
             then 'payable'
           else 'earned'
         end,
         s.paid_on, s.paid_amount
  from scope s
  join public.profiles pr on pr.id = s.recruiter_id
  join public.candidates cand on cand.id = s.candidate_id
  join public.companies co on co.id = s.company_id
  order by s.start_date desc;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.placements enable row level security;
alter table public.commissions enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

create policy "Admins can view placements" on public.placements for select to authenticated
  using ((select private.is_admin(organization_id)));
create policy "Recruiters can view placements they are credited on" on public.placements for select to authenticated
  using ((select private.is_staff(organization_id)) and exists (
    select 1 from public.commissions c where c.placement_id = placements.id and c.recruiter_id = (select auth.uid())
  ));
create policy "Admins can view commissions" on public.commissions for select to authenticated
  using ((select private.is_admin(organization_id)));
create policy "Recruiters can view their own commissions" on public.commissions for select to authenticated
  using (recruiter_id = (select auth.uid()) and (select private.is_staff(organization_id)));
create policy "Admins can view invoices" on public.invoices for select to authenticated
  using ((select private.is_admin(organization_id)));
create policy "Admins can view payments" on public.payments for select to authenticated
  using ((select private.is_admin(organization_id)));

revoke all on public.placements, public.commissions, public.invoices, public.payments from anon, authenticated;
grant select on public.placements, public.commissions, public.invoices, public.payments to authenticated;
revoke all on sequence public.invoice_number_seq from anon, authenticated;

revoke all on function
  private.require_admin(uuid),
  private.my_org(),
  private.invoice_paid(uuid),
  private.refresh_invoice_status(uuid),
  public.create_placement(uuid, date, date, numeric, public.fee_type, numeric, numeric, integer, text),
  public.update_placement_terms(uuid, date, date, numeric, public.fee_type, numeric, numeric, integer, text),
  public.set_placement_status(uuid, public.placement_status, date, text, public.falloff_resolution, numeric),
  public.link_replacement(uuid, uuid),
  public.set_commission(uuid, uuid, numeric, numeric),
  public.remove_commission(uuid),
  public.mark_commission_paid(uuid, date, numeric),
  public.create_invoice(uuid, public.invoice_kind, uuid, numeric, date, date, text),
  public.mark_invoice_sent(uuid),
  public.void_invoice(uuid, text),
  public.record_payment(uuid, numeric, date, public.payment_method, text),
  public.delete_payment(uuid, text),
  public.finance_summary(date, date),
  public.commission_overview(uuid)
  from public, anon, authenticated;

grant execute on function
  public.create_placement(uuid, date, date, numeric, public.fee_type, numeric, numeric, integer, text),
  public.update_placement_terms(uuid, date, date, numeric, public.fee_type, numeric, numeric, integer, text),
  public.set_placement_status(uuid, public.placement_status, date, text, public.falloff_resolution, numeric),
  public.link_replacement(uuid, uuid),
  public.set_commission(uuid, uuid, numeric, numeric),
  public.remove_commission(uuid),
  public.mark_commission_paid(uuid, date, numeric),
  public.create_invoice(uuid, public.invoice_kind, uuid, numeric, date, date, text),
  public.mark_invoice_sent(uuid),
  public.void_invoice(uuid, text),
  public.record_payment(uuid, numeric, date, public.payment_method, text),
  public.delete_payment(uuid, text),
  public.finance_summary(date, date),
  public.commission_overview(uuid)
  to authenticated;
