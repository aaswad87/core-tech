-- Phase 3: public website — lead capture and the public job board.
--
-- Leads are written only by the Next.js server using the Supabase secret (service-role) key after
-- validation, spam checks and rate limiting. No client role can insert or read leads, so the public
-- Supabase API cannot be used to spam or scrape them. Staff read and triage leads under RLS.

-- ---------------------------------------------------------------------------
-- Public job fields
-- ---------------------------------------------------------------------------

-- Candidate-facing description. `description` stays internal (client details, notes).
alter table public.jobs
  add column public_description text
    check (public_description is null or char_length(public_description) <= 20000);

-- Replaces the Phase 2 version: adds search, a work-arrangement filter and a total count for paging.
drop function public.get_published_jobs(integer, integer);

create function public.get_published_jobs(
  p_query text default null,
  p_work_arrangement public.work_arrangement default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  public_summary text,
  location text,
  work_arrangement public.work_arrangement,
  employment_type public.employment_type,
  published_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select
      nullif(
        replace(replace(replace(btrim(left(coalesce(p_query, ''), 100)), '\', '\\'), '%', '\%'), '_', '\_'),
        ''
      ) as pattern
  )
  select
    j.id, j.title, j.public_summary, j.location, j.work_arrangement, j.employment_type, j.published_at,
    count(*) over () as total_count
  from public.jobs j, params
  where j.status = 'published'
    and (p_work_arrangement is null or j.work_arrangement = p_work_arrangement)
    and (
      params.pattern is null
      or j.title ilike '%' || params.pattern || '%'
      or j.public_summary ilike '%' || params.pattern || '%'
      or j.location ilike '%' || params.pattern || '%'
    )
  order by j.published_at desc, j.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

create function public.get_published_job(p_job_id uuid)
returns table (
  id uuid,
  title text,
  public_summary text,
  public_description text,
  location text,
  work_arrangement public.work_arrangement,
  employment_type public.employment_type,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.title, j.public_summary, j.public_description, j.location, j.work_arrangement,
         j.employment_type, j.published_at
  from public.jobs j
  where j.id = p_job_id and j.status = 'published';
$$;

revoke all on function
  public.get_published_jobs(text, public.work_arrangement, integer, integer),
  public.get_published_job(uuid)
  from public, anon, authenticated;
grant execute on function
  public.get_published_jobs(text, public.work_arrangement, integer, integer),
  public.get_published_job(uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create type public.lead_type as enum ('contact', 'employer', 'candidate');
create type public.lead_status as enum ('new', 'in_progress', 'closed', 'spam');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  type public.lead_type not null,
  status public.lead_status not null default 'new',
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or char_length(phone) between 3 and 40),
  topic text check (topic is null or char_length(topic) <= 50),
  company_name text check (company_name is null or char_length(company_name) <= 200),
  contact_title text check (contact_title is null or char_length(contact_title) <= 200),
  role_title text check (role_title is null or char_length(role_title) <= 200),
  location text check (location is null or char_length(location) <= 200),
  positions_count integer check (positions_count is null or positions_count between 1 and 100),
  timeline text check (timeline is null or char_length(timeline) <= 50),
  specialty text check (specialty is null or char_length(specialty) <= 50),
  job_id uuid references public.jobs (id) on delete set null,
  message text check (message is null or char_length(message) <= 5000),
  consent_at timestamptz not null,
  source_path text check (source_path is null or char_length(source_path) <= 300),
  -- HMAC of the submitter's IP, used only for rate limiting. The raw IP is never stored.
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'employer' or (company_name is not null and role_title is not null))
);

create index leads_org_status_created_idx on public.leads (organization_id, status, created_at desc);
create index leads_ip_hash_created_idx on public.leads (ip_hash, created_at desc);
create index leads_email_created_idx on public.leads (lower(email), created_at desc);

create trigger leads_set_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

create function private.audit_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.organization_id, 'lead.status_changed', 'lead', new.id::text,
    jsonb_build_object('from', old.status, 'to', new.status)
  );
  return new;
end;
$$;

create trigger leads_audit_status after update of status on public.leads
  for each row when (old.status is distinct from new.status)
  execute function private.audit_lead_status();

alter table public.leads enable row level security;

create policy "Staff can view leads"
  on public.leads for select to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can update lead status"
  on public.leads for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));

revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant update (status) on public.leads to authenticated;

revoke all on function private.audit_lead_status() from public, anon, authenticated;
