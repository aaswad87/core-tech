-- Phase 2: core recruiting entities and their access rules.
--
-- Access model:
--   * Staff (admin, recruiter) work with all recruiting data in their organization.
--   * Employers see only companies they are members of, those companies' jobs, and submissions
--     explicitly made to those companies. They never read the candidates table or recruiter notes.
--   * Candidates see only their own candidate record, applications, and submissions.
--   * Anonymous visitors read published jobs only through get_published_jobs(), which returns an
--     approved set of public fields.
-- Later phases extend these tables (skills, pipeline stages, interviews, finance).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.company_member_role as enum ('owner', 'member');
create type public.job_status as enum ('draft', 'pending', 'published', 'paused', 'closed', 'archived');
create type public.work_arrangement as enum ('onsite', 'hybrid', 'remote');
create type public.employment_type as enum ('direct_hire', 'contract', 'contract_to_hire');
create type public.application_status as enum ('active', 'withdrawn', 'closed');
create type public.application_source as enum ('candidate_portal', 'recruiter');
create type public.submission_status as enum (
  'submitted', 'under_review', 'interview_requested', 'declined', 'withdrawn', 'hired'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (char_length(name) between 1 and 200),
  website text check (website is null or website ~* '^https?://'),
  industry text check (industry is null or char_length(industry) <= 120),
  -- Demo/sample records must be labeled as such in the UI.
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index companies_organization_id_idx on public.companies (organization_id);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role public.company_member_role not null default 'member',
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index company_members_user_id_idx on public.company_members (user_id);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- Linked portal account, if the candidate has one.
  user_id uuid unique references public.profiles (id) on delete set null,
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or char_length(phone) between 3 and 40),
  location text check (location is null or char_length(location) <= 200),
  headline text check (headline is null or char_length(headline) <= 200),
  summary text check (summary is null or char_length(summary) <= 5000),
  owner_id uuid references public.profiles (id) on delete set null,
  source text check (source is null or char_length(source) <= 100),
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index candidates_organization_id_idx on public.candidates (organization_id);
create index candidates_owner_id_idx on public.candidates (owner_id);
create index candidates_email_idx on public.candidates (organization_id, lower(email));

-- Internal recruiter notes. Never visible to candidates or employers.
create table public.candidate_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create index candidate_notes_candidate_id_idx on public.candidate_notes (candidate_id, created_at desc);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null,
  title text not null check (char_length(title) between 2 and 200),
  -- Candidate-facing summary; the only description exposed publicly.
  public_summary text check (public_summary is null or char_length(public_summary) <= 2000),
  description text check (description is null or char_length(description) <= 20000),
  status public.job_status not null default 'draft',
  location text check (location is null or char_length(location) <= 200),
  work_arrangement public.work_arrangement,
  employment_type public.employment_type not null default 'direct_hire',
  salary_min numeric(12, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12, 2) check (salary_max is null or salary_max >= 0),
  salary_currency char(3) not null default 'USD',
  published_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  check (status <> 'published' or published_at is not null),
  unique (id, organization_id),
  unique (id, company_id),
  foreign key (company_id, organization_id)
    references public.companies (id, organization_id)
);

create index jobs_organization_status_idx on public.jobs (organization_id, status);
create index jobs_company_id_idx on public.jobs (company_id);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  job_id uuid not null,
  status public.application_status not null default 'active',
  source public.application_source not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade,
  foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete cascade
);

-- One active application per candidate per job.
create unique index applications_one_active_per_job
  on public.applications (candidate_id, job_id) where status = 'active';
create index applications_job_id_idx on public.applications (job_id);

-- An explicit, consented submission of a candidate to an employer for a specific job.
-- The shared fields are a recruiter-curated snapshot: this is everything the employer sees.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  job_id uuid not null,
  company_id uuid not null,
  status public.submission_status not null default 'submitted',
  candidate_display_name text not null check (char_length(candidate_display_name) between 1 and 200),
  shared_summary text check (shared_summary is null or char_length(shared_summary) <= 5000),
  candidate_consent_at timestamptz not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade,
  foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete cascade,
  -- The company must be the job's company.
  foreign key (job_id, company_id)
    references public.jobs (id, company_id)
);

create unique index submissions_one_open_per_job
  on public.submissions (candidate_id, job_id) where status not in ('declined', 'withdrawn');
create index submissions_company_id_idx on public.submissions (company_id, created_at desc);

create trigger companies_set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger candidates_set_updated_at before update on public.candidates
  for each row execute function private.set_updated_at();
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
  for each row execute function private.set_updated_at();
create trigger submissions_set_updated_at before update on public.submissions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

-- Membership counts only while the user still holds the employer role in the company's organization.
create function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members cm
    join public.companies c on c.id = cm.company_id
    join public.user_roles ur
      on ur.user_id = cm.user_id
     and ur.organization_id = c.organization_id
     and ur.role = 'employer'
    where cm.company_id = p_company_id
      and cm.user_id = (select auth.uid())
  );
$$;

create function private.is_own_candidate(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.candidates c
    join public.user_roles ur
      on ur.user_id = c.user_id
     and ur.organization_id = c.organization_id
     and ur.role = 'candidate'
    where c.id = p_candidate_id
      and c.user_id = (select auth.uid())
  );
$$;

create function private.is_job_published(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.jobs j where j.id = p_job_id and j.status = 'published');
$$;

-- ---------------------------------------------------------------------------
-- Company membership management (staff only)
-- ---------------------------------------------------------------------------

create function public.add_company_member(
  p_company_id uuid,
  p_user_id uuid,
  p_member_role public.company_member_role default 'member'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select organization_id into v_org from public.companies where id = p_company_id;
  if v_org is null or not private.is_staff(v_org) then
    raise exception 'Only staff can manage company members' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = p_user_id and organization_id = v_org and role = 'employer'
  ) then
    raise exception 'User must have the employer role in this organization' using errcode = '22023';
  end if;

  insert into public.company_members (company_id, user_id, member_role, added_by)
  values (p_company_id, p_user_id, p_member_role, (select auth.uid()))
  on conflict (company_id, user_id) do update set member_role = excluded.member_role;

  perform private.write_audit(
    v_org, 'company_member.added', 'company', p_company_id::text,
    jsonb_build_object('user_id', p_user_id, 'member_role', p_member_role)
  );
  return true;
end;
$$;

create function public.remove_company_member(p_company_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select organization_id into v_org from public.companies where id = p_company_id;
  if v_org is null or not private.is_staff(v_org) then
    raise exception 'Only staff can manage company members' using errcode = '42501';
  end if;

  delete from public.company_members where company_id = p_company_id and user_id = p_user_id;
  if not found then
    return false;
  end if;

  perform private.write_audit(
    v_org, 'company_member.removed', 'company', p_company_id::text,
    jsonb_build_object('user_id', p_user_id)
  );
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public job board (approved fields only)
-- ---------------------------------------------------------------------------

create function public.get_published_jobs(p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid,
  title text,
  public_summary text,
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
  select j.id, j.title, j.public_summary, j.location, j.work_arrangement, j.employment_type, j.published_at
  from public.jobs j
  where j.status = 'published'
  order by j.published_at desc, j.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_notes enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.submissions enable row level security;

-- companies
create policy "Staff can view companies"
  on public.companies for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Employers can view their own companies"
  on public.companies for select to authenticated
  using ((select private.is_company_member(id)));
create policy "Staff can create companies"
  on public.companies for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update companies"
  on public.companies for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Admins can delete companies"
  on public.companies for delete to authenticated
  using ((select private.is_admin(organization_id)));

-- company_members (writes only through add/remove_company_member)
create policy "Staff can view company members"
  on public.company_members for select to authenticated
  using (exists (
    select 1 from public.companies c
    where c.id = company_id and (select private.is_staff(c.organization_id))
  ));
create policy "Employers can view members of their own companies"
  on public.company_members for select to authenticated
  using ((select private.is_company_member(company_id)));

-- candidates
create policy "Staff can view candidates"
  on public.candidates for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Candidates can view their own record"
  on public.candidates for select to authenticated
  using ((select private.is_own_candidate(id)));
create policy "Staff can create candidates"
  on public.candidates for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update candidates"
  on public.candidates for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Admins can delete candidates"
  on public.candidates for delete to authenticated
  using ((select private.is_admin(organization_id)));

-- candidate_notes (staff only — no candidate or employer policy exists by design)
create policy "Staff can view candidate notes"
  on public.candidate_notes for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can add candidate notes as themselves"
  on public.candidate_notes for insert to authenticated
  with check ((select private.is_staff(organization_id)) and author_id = (select auth.uid()));
create policy "Authors and admins can delete candidate notes"
  on public.candidate_notes for delete to authenticated
  using (
    (select private.is_staff(organization_id))
    and (author_id = (select auth.uid()) or (select private.is_admin(organization_id)))
  );

-- jobs (public access is only through get_published_jobs)
create policy "Staff can view jobs"
  on public.jobs for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Employers can view their company's jobs"
  on public.jobs for select to authenticated
  using ((select private.is_company_member(company_id)));
create policy "Staff can create jobs"
  on public.jobs for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update jobs"
  on public.jobs for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));

-- applications
create policy "Staff can view applications"
  on public.applications for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Candidates can view their own applications"
  on public.applications for select to authenticated
  using ((select private.is_own_candidate(candidate_id)));
create policy "Staff can create applications"
  on public.applications for insert to authenticated
  with check (
    (select private.is_staff(organization_id))
    and created_by = (select auth.uid())
    and source = 'recruiter'
  );
create policy "Candidates can apply to published jobs as themselves"
  on public.applications for insert to authenticated
  with check (
    (select private.is_own_candidate(candidate_id))
    and (select private.is_job_published(job_id))
    and created_by = (select auth.uid())
    and source = 'candidate_portal'
    and status = 'active'
  );
create policy "Staff can update applications"
  on public.applications for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));

-- submissions
create policy "Staff can view submissions"
  on public.submissions for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Employers can view submissions to their companies"
  on public.submissions for select to authenticated
  using ((select private.is_company_member(company_id)));
create policy "Candidates can view their own submissions"
  on public.submissions for select to authenticated
  using ((select private.is_own_candidate(candidate_id)));
create policy "Staff can create submissions as themselves"
  on public.submissions for insert to authenticated
  with check ((select private.is_staff(organization_id)) and submitted_by = (select auth.uid()));
create policy "Staff can update submissions"
  on public.submissions for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on
  public.companies, public.company_members, public.candidates, public.candidate_notes,
  public.jobs, public.applications, public.submissions
  from anon, authenticated;

grant select, insert, update, delete on public.companies to authenticated;
grant select on public.company_members to authenticated;
grant select, insert, update, delete on public.candidates to authenticated;
grant select, insert, delete on public.candidate_notes to authenticated;
grant select, insert, update on public.jobs to authenticated;
grant select, insert, update on public.applications to authenticated;
grant select, insert, update on public.submissions to authenticated;

revoke all on function
  private.is_company_member(uuid),
  private.is_own_candidate(uuid),
  private.is_job_published(uuid),
  public.add_company_member(uuid, uuid, public.company_member_role),
  public.remove_company_member(uuid, uuid),
  public.get_published_jobs(integer, integer)
  from public, anon, authenticated;

grant execute on function
  private.is_company_member(uuid),
  private.is_own_candidate(uuid),
  private.is_job_published(uuid),
  public.add_company_member(uuid, uuid, public.company_member_role),
  public.remove_company_member(uuid, uuid)
  to authenticated;

grant execute on function public.get_published_jobs(integer, integer) to anon, authenticated;
