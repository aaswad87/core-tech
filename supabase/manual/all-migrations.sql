-- CoreTech: all migrations in order, for pasting into the Supabase SQL editor (run once on a new project).

-- ===== 20261029000001_identity_and_roles.sql =====
-- Phase 2: identity, organizations, roles and audit log.
--
-- Conventions used by every migration in this project:
--   * Every table has RLS enabled.
--   * Supabase grants ALL on new public tables to anon/authenticated by default, so each migration
--     revokes those grants and re-grants only what the RLS policies are designed for.
--   * Authorization helpers live in the non-exposed `private` schema as SECURITY DEFINER functions
--     with an empty search_path.
--   * Role and membership changes happen only through SECURITY DEFINER functions that check the
--     caller; no client role can write to user_roles directly.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'recruiter', 'employer', 'candidate');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  -- New self-registered users join the default organization.
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index organizations_single_default on public.organizations (is_default) where is_default;

insert into public.organizations (name, slug, is_default)
values ('CoreTech Recruiting', 'coretech', true);

create table public.roles (
  role public.app_role primary key,
  description text not null
);

insert into public.roles (role, description) values
  ('admin', 'Manages users, roles, and organization settings.'),
  ('recruiter', 'Manages candidates, jobs, applications, and submissions.'),
  ('employer', 'Client company user. Sees only their company''s jobs and explicit submissions.'),
  ('candidate', 'Job seeker. Sees only their own profile and applications.');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id),
  email text not null,
  full_name text check (full_name is null or char_length(full_name) between 1 and 200),
  phone text check (phone is null or char_length(phone) between 3 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_organization_id_idx on public.profiles (organization_id);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role public.app_role not null references public.roles (role),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, organization_id, role)
);

create index user_roles_organization_id_idx on public.user_roles (organization_id, role);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create function private.write_audit(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_organization_id, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Authorization helpers (used by RLS policies)
-- ---------------------------------------------------------------------------

create function private.has_org_role(p_organization_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.organization_id = p_organization_id
      and ur.role = any (p_roles)
  );
$$;

create function private.is_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(p_organization_id, array['admin']::public.app_role[]);
$$;

-- Staff = internal CoreTech users (admins and recruiters).
create function private.is_staff(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(p_organization_id, array['admin', 'recruiter']::public.app_role[]);
$$;

create function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id from public.profiles p where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- New-user provisioning
-- ---------------------------------------------------------------------------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations where is_default;
  if v_org is null then
    raise exception 'No default organization is configured';
  end if;

  insert into public.profiles (id, organization_id, email, full_name)
  values (
    new.id,
    v_org,
    coalesce(new.email, ''),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200), '')
  );

  -- Roles are never read from user-controlled metadata (raw_user_meta_data).
  -- Public self-registration always yields only the candidate role. Users created by an
  -- administrator through the service-role API can set app_metadata.invited = true
  -- (app_metadata is not writable by end users) so that an admin assigns their role instead.
  if coalesce(new.raw_app_meta_data ->> 'invited', 'false') <> 'true' then
    insert into public.user_roles (user_id, organization_id, role)
    values (new.id, v_org, 'candidate');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Role management (the only write path for user_roles)
-- ---------------------------------------------------------------------------

create function public.assign_role(p_user_id uuid, p_role public.app_role)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select organization_id into v_org from public.profiles where id = p_user_id;
  if v_org is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if not private.is_admin(v_org) then
    raise exception 'Only administrators can assign roles' using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'You cannot change your own roles' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, organization_id, role, granted_by)
  values (p_user_id, v_org, p_role, v_actor)
  on conflict do nothing;

  if not found then
    return false;
  end if;

  perform private.write_audit(v_org, 'role.assigned', 'user', p_user_id::text, jsonb_build_object('role', p_role));
  return true;
end;
$$;

create function public.revoke_role(p_user_id uuid, p_role public.app_role)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select organization_id into v_org from public.profiles where id = p_user_id;
  if v_org is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if not private.is_admin(v_org) then
    raise exception 'Only administrators can revoke roles' using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'You cannot change your own roles' using errcode = '42501';
  end if;

  delete from public.user_roles
  where user_id = p_user_id and organization_id = v_org and role = p_role;

  if not found then
    return false;
  end if;

  perform private.write_audit(v_org, 'role.revoked', 'user', p_user_id::text, jsonb_build_object('role', p_role));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

create policy "Members can view their organization"
  on public.organizations for select to authenticated
  using (id = (select private.current_organization_id()));

create policy "Authenticated users can view role definitions"
  on public.roles for select to authenticated
  using (true);

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Staff can view profiles in their organization"
  on public.profiles for select to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Users can view their own roles"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Staff can view roles in their organization"
  on public.user_roles for select to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Admins can view the audit log"
  on public.audit_log for select to authenticated
  using ((select private.is_admin(organization_id)));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.organizations, public.roles, public.profiles, public.user_roles, public.audit_log
  from anon, authenticated;

grant select on public.organizations, public.roles, public.profiles, public.user_roles, public.audit_log
  to authenticated;
-- Users may edit only their display fields; email and organization are system-managed.
grant update (full_name, phone) on public.profiles to authenticated;

revoke all on function
  private.set_updated_at(),
  private.write_audit(uuid, text, text, text, jsonb),
  private.has_org_role(uuid, public.app_role[]),
  private.is_admin(uuid),
  private.is_staff(uuid),
  private.current_organization_id(),
  private.handle_new_user(),
  private.handle_user_email_change(),
  public.assign_role(uuid, public.app_role),
  public.revoke_role(uuid, public.app_role)
  from public, anon, authenticated;

grant execute on function
  private.has_org_role(uuid, public.app_role[]),
  private.is_admin(uuid),
  private.is_staff(uuid),
  private.current_organization_id(),
  public.assign_role(uuid, public.app_role),
  public.revoke_role(uuid, public.app_role)
  to authenticated;

-- ===== 20261029000002_recruiting_core.sql =====
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

-- ===== 20261030000001_public_site.sql =====
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

-- ===== 20261030000002_recruiter_ats.sql =====
-- Phase 4: recruiter ATS and candidate CRM.
--
-- Everything here is staff-only (admins and recruiters). Candidates and employers have no policy on
-- any of these tables, so internal notes, activity, resumes, skills and work history are never exposed
-- to them. Resumes live in a private Storage bucket, scoped by an organization-id path prefix, and are
-- read only through short-lived signed URLs created for staff.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Escapes LIKE wildcards in user search text. Returns null for blank input.
create function private.like_pattern(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    replace(replace(replace(btrim(left(coalesce(p_text, ''), 100)), '\', '\\'), '%', '\%'), '_', '\_'),
    ''
  );
$$;

-- Tags: lowercase, 1–40 chars, letters/digits and a few separators.
create function private.valid_tags(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(t ~ '^[a-z0-9][a-z0-9 +#./-]{0,39}$'), true) from unnest(p_tags) as t;
$$;

-- ---------------------------------------------------------------------------
-- Candidate columns for tags, ownership and duplicate detection
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column tags text[] not null default '{}'
    check (cardinality(tags) <= 20 and private.valid_tags(tags)),
  add column email_normalized text generated always as (nullif(lower(btrim(email)), '')) stored,
  add column phone_digits text generated always as (
    nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')
  ) stored,
  add column name_normalized text generated always as (
    lower(btrim(first_name) || ' ' || btrim(last_name))
  ) stored;

drop index public.candidates_email_idx;
create index candidates_email_normalized_idx on public.candidates (organization_id, email_normalized);
create index candidates_phone_digits_idx on public.candidates (organization_id, phone_digits);
create index candidates_name_normalized_idx on public.candidates (organization_id, name_normalized);
create index candidates_tags_idx on public.candidates using gin (tags);
create index candidates_updated_at_idx on public.candidates (organization_id, updated_at desc);

-- System-managed columns cannot change; reassigning ownership needs the current owner or an admin.
create function private.guard_candidate_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if new.organization_id <> old.organization_id
     or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'Organization, creator and creation time cannot be changed' using errcode = '42501';
  end if;

  if new.owner_id is distinct from old.owner_id
     and v_actor is not null
     and old.owner_id is not null
     and old.owner_id <> v_actor
     and not private.is_admin(old.organization_id) then
    raise exception 'Only the current owner or an administrator can reassign this candidate' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger candidates_guard_update
  before update on public.candidates
  for each row execute function private.guard_candidate_update();

create function private.validate_candidate_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.user_roles
    where user_id = new.owner_id
      and organization_id = new.organization_id
      and role in ('admin', 'recruiter')
  ) then
    raise exception 'Owner must be a recruiter or administrator in this organization' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger candidates_validate_owner
  before insert or update of owner_id on public.candidates
  for each row execute function private.validate_candidate_owner();

-- ---------------------------------------------------------------------------
-- Profile detail tables
-- ---------------------------------------------------------------------------

create table public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  name_normalized text generated always as (lower(btrim(name))) stored,
  years_experience numeric(4, 1) check (years_experience is null or years_experience between 0 and 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (candidate_id, name_normalized),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create index candidate_skills_org_name_idx on public.candidate_skills (organization_id, name_normalized);

create table public.candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  issuer text check (issuer is null or char_length(issuer) <= 200),
  credential_id text check (credential_id is null or char_length(credential_id) <= 100),
  issued_on date,
  expires_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create index candidate_certifications_candidate_idx on public.candidate_certifications (candidate_id);

create table public.candidate_work_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  location text check (location is null or char_length(location) <= 200),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  description text check (description is null or char_length(description) <= 5000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (not is_current or end_date is null),
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create index candidate_work_history_candidate_idx on public.candidate_work_history (candidate_id, start_date desc);

-- Metadata for files in the private `resumes` bucket.
create table public.candidate_resumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- The object must live under {organization_id}/{candidate_id}/ so storage policies line up.
  check (storage_path like organization_id::text || '/' || candidate_id::text || '/%'),
  unique (candidate_id, sha256),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create index candidate_resumes_candidate_idx on public.candidate_resumes (candidate_id, created_at desc);

-- Append-only activity history, written only by triggers.
create table public.candidate_activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  candidate_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create index candidate_activity_candidate_idx on public.candidate_activity (candidate_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Activity logging
-- ---------------------------------------------------------------------------

create function private.log_candidate_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_candidate uuid;
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_changed text[];
begin
  if tg_table_name = 'candidates' then
    v_candidate := (v_row ->> 'id')::uuid;
    if tg_op = 'INSERT' then
      v_action := 'candidate.created';
    elsif tg_op = 'UPDATE' then
      select array_agg(n.key order by n.key) into v_changed
      from jsonb_each(to_jsonb(new)) n
      where n.key not in ('updated_at', 'email_normalized', 'phone_digits', 'name_normalized')
        and n.value is distinct from (to_jsonb(old) -> n.key);
      if v_changed is null then
        return null;
      end if;
      v_details := jsonb_build_object('fields', to_jsonb(v_changed));
      if new.owner_id is distinct from old.owner_id then
        v_action := 'candidate.owner_changed';
        v_details := v_details || jsonb_build_object('from_owner', old.owner_id, 'to_owner', new.owner_id);
      else
        v_action := 'candidate.updated';
      end if;
    else
      return null;
    end if;
  else
    v_candidate := (v_row ->> 'candidate_id')::uuid;
    -- Child rows deleted by a candidate cascade have nothing left to attach to.
    if not exists (select 1 from public.candidates c where c.id = v_candidate) then
      return null;
    end if;
    v_action := case tg_table_name
        when 'candidate_notes' then 'note'
        when 'candidate_skills' then 'skill'
        when 'candidate_certifications' then 'certification'
        when 'candidate_work_history' then 'work_history'
        when 'candidate_resumes' then 'resume'
      end
      || case tg_op when 'INSERT' then '.added' when 'DELETE' then '.removed' else '.updated' end;
    -- Short labels only. Note bodies are never copied into the activity log.
    v_details := case tg_table_name
        when 'candidate_skills' then jsonb_build_object('name', v_row ->> 'name')
        when 'candidate_certifications' then jsonb_build_object('name', v_row ->> 'name')
        when 'candidate_work_history' then jsonb_build_object('title', v_row ->> 'title', 'company', v_row ->> 'company_name')
        when 'candidate_resumes' then jsonb_build_object('file_name', v_row ->> 'file_name')
        else '{}'::jsonb
      end;
  end if;

  insert into public.candidate_activity (organization_id, candidate_id, actor_id, action, details)
  values (v_org, v_candidate, (select auth.uid()), v_action, v_details);
  return null;
end;
$$;

create trigger candidates_log_activity
  after insert or update on public.candidates
  for each row execute function private.log_candidate_activity();
create trigger candidate_notes_log_activity
  after insert or delete on public.candidate_notes
  for each row execute function private.log_candidate_activity();
create trigger candidate_skills_log_activity
  after insert or update or delete on public.candidate_skills
  for each row execute function private.log_candidate_activity();
create trigger candidate_certifications_log_activity
  after insert or update or delete on public.candidate_certifications
  for each row execute function private.log_candidate_activity();
create trigger candidate_work_history_log_activity
  after insert or update or delete on public.candidate_work_history
  for each row execute function private.log_candidate_activity();
create trigger candidate_resumes_log_activity
  after insert or delete on public.candidate_resumes
  for each row execute function private.log_candidate_activity();

-- Candidate deletion is recorded in the organization audit log (activity is deleted with the candidate).
create function private.audit_candidate_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(old.organization_id, 'candidate.deleted', 'candidate', old.id::text, '{}'::jsonb);
  return null;
end;
$$;

create trigger candidates_audit_delete
  after delete on public.candidates
  for each row execute function private.audit_candidate_delete();

-- ---------------------------------------------------------------------------
-- Search and duplicate detection (SECURITY INVOKER: RLS applies to the caller)
-- ---------------------------------------------------------------------------

create function public.search_candidates(
  p_query text default null,
  p_owner_id uuid default null,
  p_unowned boolean default false,
  p_tag text default null,
  p_skill text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  location text,
  headline text,
  owner_id uuid,
  tags text[],
  is_demo boolean,
  updated_at timestamptz,
  skills text[],
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select
      private.like_pattern(p_query) as pattern,
      nullif(lower(btrim(coalesce(p_tag, ''))), '') as tag,
      nullif(lower(btrim(coalesce(p_skill, ''))), '') as skill
  )
  select
    c.id, c.first_name, c.last_name, c.email, c.phone, c.location, c.headline, c.owner_id, c.tags,
    c.is_demo, c.updated_at,
    coalesce(
      (select array_agg(s.name order by s.name) from public.candidate_skills s where s.candidate_id = c.id),
      '{}'
    ) as skills,
    count(*) over () as total_count
  from public.candidates c, p
  where (
      p.pattern is null
      or c.name_normalized ilike '%' || p.pattern || '%'
      or c.email ilike '%' || p.pattern || '%'
      or c.headline ilike '%' || p.pattern || '%'
      or c.location ilike '%' || p.pattern || '%'
      or exists (
        select 1 from public.candidate_skills s
        where s.candidate_id = c.id and s.name ilike '%' || p.pattern || '%'
      )
    )
    and (p_owner_id is null or c.owner_id = p_owner_id)
    and (not coalesce(p_unowned, false) or c.owner_id is null)
    and (p.tag is null or c.tags @> array[p.tag])
    and (
      p.skill is null
      or exists (select 1 from public.candidate_skills s where s.candidate_id = c.id and s.name_normalized = p.skill)
    )
  order by c.updated_at desc, c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;

create function public.find_candidate_duplicates(
  p_email text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_exclude_id uuid default null
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  match_reasons text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with i as (
    select
      nullif(lower(btrim(coalesce(p_email, ''))), '') as email,
      nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '') as phone,
      case
        when btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then null
        else lower(btrim(p_first_name) || ' ' || btrim(p_last_name))
      end as name
  ),
  m as (
    select
      c.*,
      array_remove(array[
        case when i.email is not null and c.email_normalized = i.email then 'email' end,
        case when i.phone is not null and length(i.phone) >= 7 and c.phone_digits = i.phone then 'phone' end,
        case when i.name is not null and c.name_normalized = i.name then 'name' end
      ], null) as reasons
    from public.candidates c, i
    where p_exclude_id is null or c.id <> p_exclude_id
  )
  select m.id, m.first_name, m.last_name, m.email, m.phone, m.reasons
  from m
  where cardinality(m.reasons) > 0
  order by cardinality(m.reasons) desc, m.updated_at desc
  limit 10;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (staff only)
-- ---------------------------------------------------------------------------

alter table public.candidate_skills enable row level security;
alter table public.candidate_certifications enable row level security;
alter table public.candidate_work_history enable row level security;
alter table public.candidate_resumes enable row level security;
alter table public.candidate_activity enable row level security;

create policy "Staff can view candidate skills"
  on public.candidate_skills for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can add candidate skills"
  on public.candidate_skills for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update candidate skills"
  on public.candidate_skills for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Staff can remove candidate skills"
  on public.candidate_skills for delete to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view candidate certifications"
  on public.candidate_certifications for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can add candidate certifications"
  on public.candidate_certifications for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update candidate certifications"
  on public.candidate_certifications for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Staff can remove candidate certifications"
  on public.candidate_certifications for delete to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view candidate work history"
  on public.candidate_work_history for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can add candidate work history"
  on public.candidate_work_history for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update candidate work history"
  on public.candidate_work_history for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Staff can remove candidate work history"
  on public.candidate_work_history for delete to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view resume metadata"
  on public.candidate_resumes for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can add resumes as themselves"
  on public.candidate_resumes for insert to authenticated
  with check ((select private.is_staff(organization_id)) and uploaded_by = (select auth.uid()));
create policy "Staff can remove resumes"
  on public.candidate_resumes for delete to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view candidate activity"
  on public.candidate_activity for select to authenticated
  using ((select private.is_staff(organization_id)));

revoke all on
  public.candidate_skills, public.candidate_certifications, public.candidate_work_history,
  public.candidate_resumes, public.candidate_activity
  from anon, authenticated;

grant select, insert, update, delete on public.candidate_skills to authenticated;
grant select, insert, update, delete on public.candidate_certifications to authenticated;
grant select, insert, update, delete on public.candidate_work_history to authenticated;
grant select, insert, delete on public.candidate_resumes to authenticated;
grant select on public.candidate_activity to authenticated;

-- ---------------------------------------------------------------------------
-- Private resume storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes', 'resumes', false, 4194304,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First path segment of a storage object name as an organization id, or null.
create function private.storage_path_org(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_segment::uuid;
  end if;
  return null;
end;
$$;

-- No UPDATE policy: stored resumes cannot be overwritten, only added or removed.
create policy "Staff can read resumes in their organization"
  on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (select private.is_staff(private.storage_path_org(name))));
create policy "Staff can upload resumes in their organization"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (select private.is_staff(private.storage_path_org(name))));
create policy "Staff can delete resumes in their organization"
  on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (select private.is_staff(private.storage_path_org(name))));

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.like_pattern(text),
  private.valid_tags(text[]),
  private.guard_candidate_update(),
  private.validate_candidate_owner(),
  private.log_candidate_activity(),
  private.audit_candidate_delete(),
  private.storage_path_org(text),
  public.search_candidates(text, uuid, boolean, text, text, integer, integer),
  public.find_candidate_duplicates(text, text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function
  private.like_pattern(text),
  private.valid_tags(text[]),
  private.storage_path_org(text),
  public.search_candidates(text, uuid, boolean, text, text, integer, integer),
  public.find_candidate_duplicates(text, text, text, text, uuid)
  to authenticated;

-- ===== 20261030000003_market_radar.sql =====
-- Job Market Radar: watch outside job postings (Indeed/Dice/company career sites via aggregator APIs,
-- plus public Greenhouse/Lever career feeds), match them against saved "hunts", and alert staff.
--
-- Everything is staff-only. Postings, matches, scan runs and notification logs are written only by the
-- server's scheduled scan (service role); staff can read them and change a match's review status.

-- ---------------------------------------------------------------------------
-- Types and helpers
-- ---------------------------------------------------------------------------

create type public.market_source as enum ('adzuna', 'jsearch', 'greenhouse', 'lever');
create type public.market_match_status as enum ('new', 'reviewing', 'pursued', 'dismissed');

-- Search terms: 1–80 printable characters each.
create function private.valid_terms(p_terms text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(t ~ '^[^[:cntrl:]]{1,80}$' and btrim(t) = t), true) from unnest(p_terms) as t;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.market_hunts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  keywords text[] not null check (cardinality(keywords) between 1 and 25 and private.valid_terms(keywords)),
  exclude_keywords text[] not null default '{}' check (cardinality(exclude_keywords) <= 25 and private.valid_terms(exclude_keywords)),
  locations text[] not null default '{}' check (cardinality(locations) <= 20 and private.valid_terms(locations)),
  include_remote boolean not null default true,
  sources public.market_source[] not null default '{adzuna,jsearch,greenhouse,lever}'
    check (cardinality(sources) between 1 and 4),
  min_score integer not null default 3 check (min_score between 1 and 30),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_scanned_at timestamptz
);

create index market_hunts_org_active_idx on public.market_hunts (organization_id, is_active);

create table public.market_hunt_subscribers (
  hunt_id uuid not null references public.market_hunts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hunt_id, user_id)
);

-- Company career boards hosted on Greenhouse or Lever (public job-board feeds).
create table public.market_watch_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  source public.market_source not null check (source in ('greenhouse', 'lever')),
  board_token text not null check (board_token ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, source, board_token)
);

create table public.market_postings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  source public.market_source not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  -- Normalized company|title|location, used to avoid alerting twice for the same job on two boards.
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 600),
  title text not null check (char_length(title) between 1 and 300),
  company_name text check (company_name is null or char_length(company_name) <= 200),
  location text check (location is null or char_length(location) <= 200),
  is_remote boolean not null default false,
  employment_type text check (employment_type is null or char_length(employment_type) <= 50),
  salary_min numeric(12, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12, 2) check (salary_max is null or salary_max >= 0),
  -- Plain text only (HTML is stripped server-side before storage).
  description_snippet text check (description_snippet is null or char_length(description_snippet) <= 4000),
  url text not null check (char_length(url) <= 2000 and url ~ '^https://'),
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (organization_id, source, external_id),
  unique (id, organization_id)
);

create index market_postings_dedupe_idx on public.market_postings (organization_id, dedupe_key);
create index market_postings_first_seen_idx on public.market_postings (organization_id, first_seen_at desc);

create table public.market_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  hunt_id uuid not null references public.market_hunts (id) on delete cascade,
  posting_id uuid not null,
  score integer not null check (score >= 0),
  matched_terms text[] not null default '{}',
  status public.market_match_status not null default 'new',
  notified_at timestamptz,
  pursued_job_id uuid references public.jobs (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (hunt_id, posting_id),
  foreign key (posting_id, organization_id)
    references public.market_postings (id, organization_id) on delete cascade
);

create index market_matches_org_status_idx on public.market_matches (organization_id, status, created_at desc);

create table public.market_scan_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  trigger text not null check (trigger in ('schedule', 'manual')),
  triggered_by uuid references public.profiles (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

create index market_scan_runs_org_started_idx on public.market_scan_runs (organization_id, started_at desc);

-- Outcome of every notification attempt. "sent" means the provider accepted it (not proof of inbox delivery).
create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id),
  channel text not null check (channel in ('email', 'slack')),
  recipient text not null check (char_length(recipient) between 1 and 320),
  subject text check (subject is null or char_length(subject) <= 300),
  related_type text not null check (char_length(related_type) between 1 and 50),
  related_id text check (related_id is null or char_length(related_id) <= 100),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now()
);

create index notification_deliveries_org_created_idx on public.notification_deliveries (organization_id, created_at desc);

create trigger market_hunts_set_updated_at before update on public.market_hunts
  for each row execute function private.set_updated_at();

-- Review fields are system-set: reviewer is always the signed-in user, and a pursued job must belong
-- to the same organization.
create function private.guard_market_match_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  end if;
  if new.pursued_job_id is not null
     and new.pursued_job_id is distinct from old.pursued_job_id
     and not exists (
       select 1 from public.jobs j where j.id = new.pursued_job_id and j.organization_id = new.organization_id
     ) then
    raise exception 'The pursued job must belong to the same organization' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger market_matches_guard_update
  before update on public.market_matches
  for each row execute function private.guard_market_match_update();

-- ---------------------------------------------------------------------------
-- Row Level Security (staff only)
-- ---------------------------------------------------------------------------

alter table public.market_hunts enable row level security;
alter table public.market_hunt_subscribers enable row level security;
alter table public.market_watch_companies enable row level security;
alter table public.market_postings enable row level security;
alter table public.market_matches enable row level security;
alter table public.market_scan_runs enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "Staff can view hunts" on public.market_hunts for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can create hunts as themselves" on public.market_hunts for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update hunts" on public.market_hunts for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Creators and admins can delete hunts" on public.market_hunts for delete to authenticated
  using (
    (select private.is_staff(organization_id))
    and (created_by = (select auth.uid()) or (select private.is_admin(organization_id)))
  );

create policy "Staff can view hunt subscribers" on public.market_hunt_subscribers for select to authenticated
  using (exists (
    select 1 from public.market_hunts h where h.id = hunt_id and (select private.is_staff(h.organization_id))
  ));
create policy "Staff can subscribe themselves" on public.market_hunt_subscribers for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.market_hunts h where h.id = hunt_id and (select private.is_staff(h.organization_id)))
  );
create policy "Staff can unsubscribe themselves" on public.market_hunt_subscribers for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Staff can view watched companies" on public.market_watch_companies for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can add watched companies" on public.market_watch_companies for insert to authenticated
  with check ((select private.is_staff(organization_id)) and created_by = (select auth.uid()));
create policy "Staff can update watched companies" on public.market_watch_companies for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));
create policy "Staff can remove watched companies" on public.market_watch_companies for delete to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view postings" on public.market_postings for select to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view matches" on public.market_matches for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can review matches" on public.market_matches for update to authenticated
  using ((select private.is_staff(organization_id)))
  with check ((select private.is_staff(organization_id)));

create policy "Staff can view scan runs" on public.market_scan_runs for select to authenticated
  using ((select private.is_staff(organization_id)));

create policy "Staff can view notification log" on public.notification_deliveries for select to authenticated
  using ((select private.is_staff(organization_id)));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on
  public.market_hunts, public.market_hunt_subscribers, public.market_watch_companies, public.market_postings,
  public.market_matches, public.market_scan_runs, public.notification_deliveries
  from anon, authenticated;

grant select, insert, update, delete on public.market_hunts to authenticated;
grant select, insert, delete on public.market_hunt_subscribers to authenticated;
grant select, insert, update, delete on public.market_watch_companies to authenticated;
grant select on public.market_postings, public.market_scan_runs, public.notification_deliveries to authenticated;
grant select on public.market_matches to authenticated;
grant update (status, pursued_job_id) on public.market_matches to authenticated;

revoke all on function private.valid_terms(text[]), private.guard_market_match_update() from public, anon, authenticated;
grant execute on function private.valid_terms(text[]) to authenticated;

-- ===== 20261030000004_jobs_and_pipeline.sql =====
-- Phases 5 & 6: job management, candidate applications, and the recruiting pipeline.
--
--  * Jobs gain required/preferred skills and a recruiter owner; publishing stamps published_at and every
--    status change is audited.
--  * Candidates apply through apply_to_job(), which creates their candidate record on first use.
--  * Applications move through pipeline stages only via SECURITY DEFINER functions, so every move records
--    the actor, timestamp, previous and new stage, and reason in application_stage_events.
--  * "Submitted to Client" can only be reached through submit_application_to_client(), which requires
--    recorded candidate consent and creates the submission the employer sees.

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

alter table public.jobs
  add column required_skills text[] not null default '{}'
    check (cardinality(required_skills) <= 30 and private.valid_terms(required_skills)),
  add column preferred_skills text[] not null default '{}'
    check (cardinality(preferred_skills) <= 30 and private.valid_terms(preferred_skills)),
  add column owner_id uuid references public.profiles (id) on delete set null;

create index jobs_owner_id_idx on public.jobs (owner_id);

create function private.prepare_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) and not exists (
    select 1 from public.user_roles
    where user_id = new.owner_id and organization_id = new.organization_id and role in ('admin', 'recruiter')
  ) then
    raise exception 'Job owner must be a recruiter or administrator in this organization' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.created_by is distinct from old.created_by) then
    raise exception 'Organization and creator cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger jobs_prepare
  before insert or update on public.jobs
  for each row execute function private.prepare_job();

create function private.audit_job_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.organization_id, 'job.status_changed', 'job', new.id::text,
    jsonb_build_object('from', old.status, 'to', new.status)
  );
  return null;
end;
$$;

create trigger jobs_audit_status
  after update of status on public.jobs
  for each row when (old.status is distinct from new.status)
  execute function private.audit_job_status();

-- Public job detail now includes skills (approved public fields).
drop function public.get_published_job(uuid);

create function public.get_published_job(p_job_id uuid)
returns table (
  id uuid,
  title text,
  public_summary text,
  public_description text,
  location text,
  work_arrangement public.work_arrangement,
  employment_type public.employment_type,
  published_at timestamptz,
  required_skills text[],
  preferred_skills text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.title, j.public_summary, j.public_description, j.location, j.work_arrangement,
         j.employment_type, j.published_at, j.required_skills, j.preferred_skills
  from public.jobs j
  where j.id = p_job_id and j.status = 'published';
$$;

revoke all on function public.get_published_job(uuid) from public, anon, authenticated;
grant execute on function public.get_published_job(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pipeline stages
-- ---------------------------------------------------------------------------

create type public.application_stage as enum (
  'new', 'screening', 'recruiter_interview', 'technical_evaluation', 'submitted_to_client',
  'client_interview', 'offer', 'placed', 'rejected', 'withdrawn', 'on_hold', 'future_opportunity'
);

alter table public.applications
  add column stage public.application_stage not null default 'new',
  add column stage_changed_at timestamptz not null default now(),
  add constraint applications_id_org_key unique (id, organization_id);

create index applications_org_stage_idx on public.applications (organization_id, stage, stage_changed_at desc);

-- The coarse status follows the stage: closed stages free the candidate to be considered for the job again.
create function private.stage_status(p_stage public.application_stage)
returns public.application_status
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'withdrawn' then 'withdrawn'::public.application_status
    when 'rejected' then 'closed'::public.application_status
    when 'placed' then 'closed'::public.application_status
    when 'future_opportunity' then 'closed'::public.application_status
    else 'active'::public.application_status
  end;
$$;

create function private.sync_application_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := private.stage_status(new.stage);
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger applications_sync_stage
  before insert or update of stage on public.applications
  for each row execute function private.sync_application_stage();

-- Append-only stage history. Reasons are internal: staff only.
create table public.application_stage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  application_id uuid not null,
  from_stage public.application_stage,
  to_stage public.application_stage not null,
  reason text check (reason is null or char_length(reason) <= 1000),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (application_id, organization_id)
    references public.applications (id, organization_id) on delete cascade
);

create index application_stage_events_app_idx on public.application_stage_events (application_id, created_at desc, id desc);

create function private.log_application_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.application_stage_events (organization_id, application_id, from_stage, to_stage, reason, actor_id)
  values (
    new.organization_id, new.id, null, new.stage,
    case new.source when 'candidate_portal' then 'Applied through the website' else 'Added by a recruiter' end,
    (select auth.uid())
  );
  return null;
end;
$$;

create trigger applications_log_created
  after insert on public.applications
  for each row execute function private.log_application_created();

-- Stages that need a written reason.
create function private.stage_requires_reason(p_stage public.application_stage)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_stage in ('rejected', 'withdrawn', 'on_hold', 'future_opportunity');
$$;

-- ---------------------------------------------------------------------------
-- Pipeline functions (the only way to change a stage)
-- ---------------------------------------------------------------------------

create function public.move_application_stage(
  p_application_id uuid,
  p_to_stage public.application_stage,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_app record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.id, a.organization_id, a.stage into v_app from public.applications a where a.id = p_application_id for update;
  if not found or not private.is_staff(v_app.organization_id) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;

  if v_app.stage = p_to_stage then
    return;
  end if;
  if p_to_stage = 'submitted_to_client' then
    raise exception 'Submitting to a client requires recorded candidate consent; use the submit action' using errcode = '22023';
  end if;
  if private.stage_requires_reason(p_to_stage) and v_reason is null then
    raise exception 'A reason is required for this stage' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Reason must be 1000 characters or fewer' using errcode = '22023';
  end if;
  if v_app.stage = 'placed' and not private.is_admin(v_app.organization_id) then
    raise exception 'Only an administrator can move a candidate out of Placed' using errcode = '42501';
  end if;

  update public.applications set stage = p_to_stage where id = p_application_id;

  insert into public.application_stage_events (organization_id, application_id, from_stage, to_stage, reason, actor_id)
  values (v_app.organization_id, p_application_id, v_app.stage, p_to_stage, v_reason, v_actor);

  if p_to_stage in ('placed', 'rejected', 'offer') or v_app.stage = 'placed' then
    perform private.write_audit(
      v_app.organization_id, 'application.stage_changed', 'application', p_application_id::text,
      jsonb_build_object('from', v_app.stage, 'to', p_to_stage)
    );
  end if;
end;
$$;

create function public.submit_application_to_client(
  p_application_id uuid,
  p_display_name text,
  p_shared_summary text,
  p_consent_confirmed boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_app record;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_summary text := nullif(btrim(coalesce(p_shared_summary, '')), '');
  v_submission uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.id, a.organization_id, a.stage, a.status, a.candidate_id, a.job_id, j.company_id
    into v_app
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.id = p_application_id
  for update of a;
  if not found or not private.is_staff(v_app.organization_id) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;

  if coalesce(p_consent_confirmed, false) is false then
    raise exception 'Confirm the candidate agreed to be submitted to this employer' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'Enter the name to show the employer' using errcode = '22023';
  end if;
  if v_summary is not null and char_length(v_summary) > 5000 then
    raise exception 'Summary must be 5000 characters or fewer' using errcode = '22023';
  end if;
  if v_app.status <> 'active' then
    raise exception 'Only active applications can be submitted' using errcode = '22023';
  end if;
  if v_app.stage = 'placed' then
    raise exception 'This candidate is already placed' using errcode = '22023';
  end if;

  insert into public.submissions (
    organization_id, candidate_id, job_id, company_id, candidate_display_name, shared_summary,
    candidate_consent_at, submitted_by
  ) values (
    v_app.organization_id, v_app.candidate_id, v_app.job_id, v_app.company_id, v_name, v_summary, now(), v_actor
  )
  returning id into v_submission;

  update public.applications set stage = 'submitted_to_client' where id = p_application_id;

  insert into public.application_stage_events (organization_id, application_id, from_stage, to_stage, reason, actor_id)
  values (v_app.organization_id, p_application_id, v_app.stage, 'submitted_to_client',
          'Submitted to the employer with candidate consent', v_actor);

  perform private.write_audit(
    v_app.organization_id, 'submission.created', 'submission', v_submission::text,
    jsonb_build_object('application_id', p_application_id)
  );
  return v_submission;
end;
$$;

create function public.apply_to_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job record;
  v_profile record;
  v_candidate uuid;
  v_application uuid;
  v_full text;
begin
  if v_actor is null then
    raise exception 'Sign in to apply' using errcode = '42501';
  end if;

  select j.id, j.organization_id into v_job from public.jobs j where j.id = p_job_id and j.status = 'published';
  if not found then
    raise exception 'This job is no longer accepting applications' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_actor and organization_id = v_job.organization_id and role = 'candidate'
  ) then
    raise exception 'Only candidate accounts can apply' using errcode = '42501';
  end if;

  select c.id into v_candidate from public.candidates c where c.user_id = v_actor;
  if v_candidate is null then
    select p.full_name, p.email into v_profile from public.profiles p where p.id = v_actor;
    v_full := btrim(coalesce(v_profile.full_name, ''));
    insert into public.candidates (organization_id, user_id, first_name, last_name, email, source, created_by)
    values (
      v_job.organization_id,
      v_actor,
      left(coalesce(nullif(split_part(v_full, ' ', 1), ''), 'Candidate'), 100),
      left(case when position(' ' in v_full) > 0 then btrim(substr(v_full, position(' ' in v_full) + 1)) else '-' end, 100),
      nullif(v_profile.email, ''),
      'Candidate portal',
      v_actor
    )
    returning id into v_candidate;
  end if;

  begin
    insert into public.applications (organization_id, candidate_id, job_id, source, created_by)
    values (v_job.organization_id, v_candidate, p_job_id, 'candidate_portal', v_actor)
    returning id into v_application;
  exception when unique_violation then
    raise exception 'You already have an active application for this job' using errcode = '23505';
  end;

  return v_application;
end;
$$;

create function public.withdraw_my_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
begin
  select a.id, a.organization_id, a.stage, a.status, a.candidate_id into v_app
  from public.applications a where a.id = p_application_id for update;
  if not found or not private.is_own_candidate(v_app.candidate_id) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if v_app.status <> 'active' then
    raise exception 'This application is already closed' using errcode = '22023';
  end if;

  update public.applications set stage = 'withdrawn' where id = p_application_id;
  insert into public.application_stage_events (organization_id, application_id, from_stage, to_stage, reason, actor_id)
  values (v_app.organization_id, p_application_id, v_app.stage, 'withdrawn', 'Withdrawn by the candidate', (select auth.uid()));
end;
$$;

-- The signed-in candidate's own applications with a simplified, candidate-facing status. Internal stage
-- names and reasons are never exposed here.
create function public.my_applications()
returns table (
  id uuid,
  job_id uuid,
  job_title text,
  job_is_open boolean,
  status_label text,
  applied_at timestamptz,
  can_withdraw boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.job_id,
    j.title,
    j.status = 'published',
    case
      when a.stage = 'placed' then 'Hired'
      when a.status = 'withdrawn' then 'Withdrawn'
      when a.status = 'closed' then 'Closed'
      else 'In progress'
    end,
    a.created_at,
    a.status = 'active'
  from public.applications a
  join public.candidates c on c.id = a.candidate_id
  join public.jobs j on j.id = a.job_id
  where c.user_id = (select auth.uid())
  order by a.created_at desc
  limit 100;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

-- Stage changes go through the functions above; no direct updates to applications.
revoke update on public.applications from authenticated;
drop policy "Staff can update applications" on public.applications;

alter table public.application_stage_events enable row level security;
create policy "Staff can view stage history" on public.application_stage_events for select to authenticated
  using ((select private.is_staff(organization_id)));

revoke all on public.application_stage_events from anon, authenticated;
grant select on public.application_stage_events to authenticated;

revoke all on function
  private.prepare_job(),
  private.audit_job_status(),
  private.stage_status(public.application_stage),
  private.sync_application_stage(),
  private.log_application_created(),
  private.stage_requires_reason(public.application_stage),
  public.move_application_stage(uuid, public.application_stage, text),
  public.submit_application_to_client(uuid, text, text, boolean),
  public.apply_to_job(uuid),
  public.withdraw_my_application(uuid),
  public.my_applications()
  from public, anon, authenticated;

grant execute on function
  private.stage_status(public.application_stage),
  private.sync_application_stage(),
  private.stage_requires_reason(public.application_stage),
  public.move_application_stage(uuid, public.application_stage, text),
  public.submit_application_to_client(uuid, text, text, boolean),
  public.apply_to_job(uuid),
  public.withdraw_my_application(uuid),
  public.my_applications()
  to authenticated;

-- ===== 20261103000001_candidate_portal.sql =====
-- Phase 8: candidate portal.
--
-- Candidates manage an approved subset of their own record. They never get a direct UPDATE grant on
-- public.candidates (that row also holds recruiter-only fields such as tags, owner and source); every
-- change goes through a SECURITY DEFINER function that writes only the approved columns.
--
--   * update_my_candidate_profile(): name, phone, location, headline, summary
--   * own resumes: upload/list/download/remove under {org}/{candidate}/ in the private bucket;
--     candidates may remove only files they uploaded themselves (never one a recruiter added)
--   * candidate_preferences: job interests and communication choices (set_my_preferences())
--   * privacy_requests: access/correction/deletion/stop-contact requests, resolved by administrators
--
-- Recruiter notes, activity, skills and work history keep their staff-only policies.

-- ---------------------------------------------------------------------------
-- The caller's candidate record (created on first use, like apply_to_job does)
-- ---------------------------------------------------------------------------

create function private.ensure_my_candidate()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_candidate uuid;
  v_profile record;
  v_full text;
begin
  if v_actor is null then
    raise exception 'Sign in to continue' using errcode = '42501';
  end if;

  select ur.organization_id into v_org
  from public.user_roles ur
  where ur.user_id = v_actor and ur.role = 'candidate'
  limit 1;
  if v_org is null then
    raise exception 'Only candidate accounts have a candidate profile' using errcode = '42501';
  end if;

  select c.id into v_candidate from public.candidates c where c.user_id = v_actor;
  if v_candidate is not null then
    return v_candidate;
  end if;

  select p.full_name, p.email into v_profile from public.profiles p where p.id = v_actor;
  v_full := btrim(coalesce(v_profile.full_name, ''));
  insert into public.candidates (organization_id, user_id, first_name, last_name, email, source, created_by)
  values (
    v_org,
    v_actor,
    left(coalesce(nullif(split_part(v_full, ' ', 1), ''), 'Candidate'), 100),
    left(case when position(' ' in v_full) > 0 then btrim(substr(v_full, position(' ' in v_full) + 1)) else '-' end, 100),
    nullif(v_profile.email, ''),
    'Candidate portal',
    v_actor
  )
  returning id into v_candidate;

  return v_candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------

create function public.update_my_candidate_profile(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_location text,
  p_headline text,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid := private.ensure_my_candidate();
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
begin
  if v_first = '' or v_last = '' then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;

  -- Table check constraints enforce lengths and formats.
  update public.candidates
  set first_name = v_first,
      last_name = v_last,
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      location = nullif(btrim(coalesce(p_location, '')), ''),
      headline = nullif(btrim(coalesce(p_headline, '')), ''),
      summary = nullif(btrim(coalesce(p_summary, '')), '')
  where id = v_candidate;

  update public.profiles
  set full_name = left(v_first || ' ' || v_last, 200)
  where id = (select auth.uid());

  return v_candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Own resumes
-- ---------------------------------------------------------------------------

-- Second segment of a storage object name ({org}/{candidate}/{file}) as a candidate id, or null.
create function private.storage_path_candidate(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if v_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_segment::uuid;
  end if;
  return null;
end;
$$;

-- True when the object lives in the caller's own candidate folder of the right organization.
create function private.is_own_resume_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.candidates c
    where c.id = private.storage_path_candidate(p_name)
      and c.organization_id = private.storage_path_org(p_name)
      and private.is_own_candidate(c.id)
  );
$$;

-- A candidate may delete a stored file only when no metadata row added by someone else points at it
-- (the app deletes the candidate's own metadata row first, then the file).
create function private.can_remove_own_resume_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_own_resume_path(p_name)
    and not exists (
      select 1 from public.candidate_resumes r
      where r.storage_path = p_name and r.uploaded_by is distinct from (select auth.uid())
    );
$$;

/** Resumes a candidate may keep on file at once (recruiter uploads don't count). */
create function private.own_resume_count(p_candidate_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.candidate_resumes r
  where r.candidate_id = p_candidate_id and r.uploaded_by = (select auth.uid());
$$;

create policy "Candidates can view their own resumes"
  on public.candidate_resumes for select to authenticated
  using ((select private.is_own_candidate(candidate_id)));
create policy "Candidates can add their own resumes"
  on public.candidate_resumes for insert to authenticated
  with check (
    (select private.is_own_candidate(candidate_id))
    and uploaded_by = (select auth.uid())
    and private.own_resume_count(candidate_id) < 5
  );
create policy "Candidates can remove resumes they uploaded"
  on public.candidate_resumes for delete to authenticated
  using ((select private.is_own_candidate(candidate_id)) and uploaded_by = (select auth.uid()));

create policy "Candidates can read their own resume files"
  on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (select private.is_own_resume_path(name)));
create policy "Candidates can upload to their own resume folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (select private.is_own_resume_path(name)));
create policy "Candidates can delete their own resume files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (select private.can_remove_own_resume_object(name)));

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

-- work_arrangement reuses the jobs enum (onsite, hybrid, remote); null means no preference.
create table public.candidate_preferences (
  candidate_id uuid primary key,
  organization_id uuid not null,
  open_to_opportunities boolean not null default true,
  desired_titles text check (desired_titles is null or char_length(desired_titles) <= 300),
  preferred_locations text check (preferred_locations is null or char_length(preferred_locations) <= 300),
  work_arrangement public.work_arrangement,
  willing_to_relocate boolean not null default false,
  email_job_alerts boolean not null default false,
  email_application_updates boolean not null default true,
  phone_contact_ok boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id)
    references public.candidates (id, organization_id) on delete cascade
);

create function public.set_my_preferences(
  p_open_to_opportunities boolean,
  p_desired_titles text,
  p_preferred_locations text,
  p_work_arrangement public.work_arrangement,
  p_willing_to_relocate boolean,
  p_email_job_alerts boolean,
  p_email_application_updates boolean,
  p_phone_contact_ok boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid := private.ensure_my_candidate();
  v_org uuid;
begin
  select c.organization_id into v_org from public.candidates c where c.id = v_candidate;

  insert into public.candidate_preferences as cp (
    candidate_id, organization_id, open_to_opportunities, desired_titles, preferred_locations,
    work_arrangement, willing_to_relocate, email_job_alerts, email_application_updates, phone_contact_ok
  )
  values (
    v_candidate, v_org, coalesce(p_open_to_opportunities, true),
    nullif(btrim(coalesce(p_desired_titles, '')), ''), nullif(btrim(coalesce(p_preferred_locations, '')), ''),
    p_work_arrangement, coalesce(p_willing_to_relocate, false), coalesce(p_email_job_alerts, false),
    coalesce(p_email_application_updates, true), coalesce(p_phone_contact_ok, false)
  )
  on conflict (candidate_id) do update
  set open_to_opportunities = excluded.open_to_opportunities,
      desired_titles = excluded.desired_titles,
      preferred_locations = excluded.preferred_locations,
      work_arrangement = excluded.work_arrangement,
      willing_to_relocate = excluded.willing_to_relocate,
      email_job_alerts = excluded.email_job_alerts,
      email_application_updates = excluded.email_application_updates,
      phone_contact_ok = excluded.phone_contact_ok,
      updated_at = now();
end;
$$;

alter table public.candidate_preferences enable row level security;

create policy "Candidates can view their own preferences"
  on public.candidate_preferences for select to authenticated
  using ((select private.is_own_candidate(candidate_id)));
create policy "Staff can view candidate preferences"
  on public.candidate_preferences for select to authenticated
  using ((select private.is_staff(organization_id)));

revoke all on public.candidate_preferences from anon, authenticated;
grant select on public.candidate_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- Privacy requests
-- ---------------------------------------------------------------------------

create type public.privacy_request_kind as enum ('access', 'correction', 'deletion', 'stop_contact');
create type public.privacy_request_status as enum ('open', 'in_progress', 'completed', 'declined');

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- Kept (set null) if the account is later deleted, so completed requests remain on record.
  user_id uuid references public.profiles (id) on delete set null,
  requester_email text not null check (char_length(requester_email) <= 254),
  kind public.privacy_request_kind not null,
  details text check (details is null or char_length(details) <= 2000),
  status public.privacy_request_status not null default 'open',
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index privacy_requests_org_status_idx on public.privacy_requests (organization_id, status, created_at desc);
-- One pending request of each kind per person.
create unique index privacy_requests_one_pending_idx
  on public.privacy_requests (user_id, kind) where status in ('open', 'in_progress');

create function public.submit_privacy_request(p_kind public.privacy_request_kind, p_details text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_profile record;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Sign in to send a privacy request' using errcode = '42501';
  end if;
  if p_kind is null then
    raise exception 'Choose a request type' using errcode = '22023';
  end if;
  select p.organization_id, p.email into v_profile from public.profiles p where p.id = v_actor;

  begin
    insert into public.privacy_requests (organization_id, user_id, requester_email, kind, details)
    values (v_profile.organization_id, v_actor, v_profile.email, p_kind, nullif(btrim(coalesce(p_details, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have a pending request of this type' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create function public.resolve_privacy_request(
  p_request_id uuid,
  p_status public.privacy_request_status,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org from public.privacy_requests r where r.id = p_request_id for update;
  if v_org is null or not private.is_admin(v_org) then
    raise exception 'Privacy request not found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status = 'open' then
    raise exception 'Choose in progress, completed or declined' using errcode = '22023';
  end if;
  if p_status = 'declined' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Explain why the request is declined' using errcode = '22023';
  end if;

  update public.privacy_requests
  set status = p_status,
      resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
      resolved_by = case when p_status in ('completed', 'declined') then (select auth.uid()) end,
      resolved_at = case when p_status in ('completed', 'declined') then now() end,
      updated_at = now()
  where id = p_request_id;
end;
$$;

alter table public.privacy_requests enable row level security;

create policy "People can view their own privacy requests"
  on public.privacy_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Admins can view privacy requests"
  on public.privacy_requests for select to authenticated
  using ((select private.is_admin(organization_id)));

revoke all on public.privacy_requests from anon, authenticated;
grant select on public.privacy_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.ensure_my_candidate(),
  private.storage_path_candidate(text),
  private.is_own_resume_path(text),
  private.can_remove_own_resume_object(text),
  private.own_resume_count(uuid),
  public.update_my_candidate_profile(text, text, text, text, text, text),
  public.set_my_preferences(boolean, text, text, public.work_arrangement, boolean, boolean, boolean, boolean),
  public.submit_privacy_request(public.privacy_request_kind, text),
  public.resolve_privacy_request(uuid, public.privacy_request_status, text)
  from public, anon, authenticated;

grant execute on function
  private.storage_path_candidate(text),
  private.is_own_resume_path(text),
  private.can_remove_own_resume_object(text),
  private.own_resume_count(uuid),
  public.update_my_candidate_profile(text, text, text, text, text, text),
  public.set_my_preferences(boolean, text, text, public.work_arrangement, boolean, boolean, boolean, boolean),
  public.submit_privacy_request(public.privacy_request_kind, text),
  public.resolve_privacy_request(uuid, public.privacy_request_status, text)
  to authenticated;

-- ===== 20261104000001_employer_portal.sql =====
-- Phase 7: employer portal.
--
-- Employers (users with the employer role who are members of a company) work only with their own
-- companies. Every employer write goes through a SECURITY DEFINER function that checks membership, so
-- nothing here grants direct INSERT/UPDATE on shared tables.
--
--   * Company profile: owners edit website, industry, headquarters and an about text (name stays staff-managed).
--   * Team: members see their colleagues; owners change member roles, remove members and ask CoreTech to
--     add a teammate (staff add the account, since employer roles are granted by administrators).
--   * Job requests: employers ask CoreTech to open a role; staff review, decline or convert them to a draft job.
--   * Submissions: employers see only the recruiter-curated snapshot, move it to under review / interview
--     requested / declined, and leave feedback. A resume is visible only when a recruiter explicitly shares
--     one with that submission, only while the submission is open, and every view is audited.
--   * Interview requests: employers propose times; staff confirm or decline (full scheduling is Phase 9).
--
-- Employers still never read candidates, candidate notes, applications or pipeline history.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.is_company_owner(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_company_member(p_company_id)
    and exists (
      select 1 from public.company_members cm
      where cm.company_id = p_company_id and cm.user_id = (select auth.uid()) and cm.member_role = 'owner'
    );
$$;

-- ---------------------------------------------------------------------------
-- Company profile
-- ---------------------------------------------------------------------------

alter table public.companies
  add column headquarters text check (headquarters is null or char_length(headquarters) <= 200),
  add column about text check (about is null or char_length(about) <= 2000);

create function public.update_my_company(
  p_company_id uuid,
  p_website text,
  p_industry text,
  p_headquarters text,
  p_about text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_company_owner(p_company_id) then
    raise exception 'Only company owners can edit the company profile' using errcode = '42501';
  end if;

  update public.companies
  set website = nullif(btrim(coalesce(p_website, '')), ''),
      industry = nullif(btrim(coalesce(p_industry, '')), ''),
      headquarters = nullif(btrim(coalesce(p_headquarters, '')), ''),
      about = nullif(btrim(coalesce(p_about, '')), '')
  where id = p_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------------

-- Colleagues of a company the caller belongs to (employers can't read other people's profiles directly).
create function public.company_team(p_company_id uuid)
returns table (user_id uuid, full_name text, email text, member_role public.company_member_role, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.user_id, p.full_name, p.email, cm.member_role, cm.created_at
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.company_id = p_company_id
    -- Only people who still hold the employer role (revoked accounts have no access).
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = cm.user_id and ur.organization_id = p.organization_id and ur.role = 'employer'
    )
    and (private.is_company_member(p_company_id)
         or private.is_staff((select c.organization_id from public.companies c where c.id = p_company_id)))
  order by cm.member_role, p.full_name nulls last, p.email;
$$;

-- Owners manage their team, but a company always keeps at least one owner.
create function public.set_company_member_role_as_owner(
  p_company_id uuid,
  p_user_id uuid,
  p_member_role public.company_member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.is_company_owner(p_company_id) then
    raise exception 'Only company owners can manage the team' using errcode = '42501';
  end if;
  if p_member_role is null then
    raise exception 'Choose a role' using errcode = '22023';
  end if;
  perform 1 from public.company_members where company_id = p_company_id for update;
  if not exists (select 1 from public.company_members where company_id = p_company_id and user_id = p_user_id) then
    raise exception 'Team member not found' using errcode = 'P0002';
  end if;
  if p_member_role = 'member' and not exists (
    select 1 from public.company_members
    where company_id = p_company_id and member_role = 'owner' and user_id <> p_user_id
  ) then
    raise exception 'The company needs at least one owner' using errcode = '22023';
  end if;

  update public.company_members set member_role = p_member_role where company_id = p_company_id and user_id = p_user_id;

  select organization_id into v_org from public.companies where id = p_company_id;
  perform private.write_audit(
    v_org, 'company_member.role_changed', 'company', p_company_id::text,
    jsonb_build_object('user_id', p_user_id, 'member_role', p_member_role)
  );
end;
$$;

create function public.remove_company_member_as_owner(p_company_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.is_company_owner(p_company_id) then
    raise exception 'Only company owners can manage the team' using errcode = '42501';
  end if;
  perform 1 from public.company_members where company_id = p_company_id for update;
  if not exists (
    select 1 from public.company_members
    where company_id = p_company_id and member_role = 'owner' and user_id <> p_user_id
  ) then
    raise exception 'The company needs at least one owner' using errcode = '22023';
  end if;

  delete from public.company_members where company_id = p_company_id and user_id = p_user_id;
  if not found then
    raise exception 'Team member not found' using errcode = 'P0002';
  end if;

  select organization_id into v_org from public.companies where id = p_company_id;
  perform private.write_audit(
    v_org, 'company_member.removed', 'company', p_company_id::text,
    jsonb_build_object('user_id', p_user_id, 'by', 'company_owner')
  );
end;
$$;

create type public.member_request_status as enum ('pending', 'completed', 'dismissed');

-- An owner's request for CoreTech to give a colleague access.
create table public.company_member_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null,
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  member_role public.company_member_role not null default 'member',
  status public.member_request_status not null default 'pending',
  requested_by uuid references public.profiles (id) on delete set null,
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete cascade
);

create unique index company_member_requests_one_pending_idx
  on public.company_member_requests (company_id, lower(email)) where status = 'pending';

create function public.request_company_member(
  p_company_id uuid,
  p_full_name text,
  p_email text,
  p_member_role public.company_member_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if not private.is_company_owner(p_company_id) then
    raise exception 'Only company owners can add teammates' using errcode = '42501';
  end if;
  select organization_id into v_org from public.companies where id = p_company_id;
  begin
    insert into public.company_member_requests (organization_id, company_id, full_name, email, member_role, requested_by)
    values (v_org, p_company_id, btrim(coalesce(p_full_name, '')), lower(btrim(coalesce(p_email, ''))),
            coalesce(p_member_role, 'member'), (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A request for this email is already pending' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create function public.handle_company_member_request(p_request_id uuid, p_status public.member_request_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.company_member_requests where id = p_request_id;
  if v_org is null or not private.is_staff(v_org) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status = 'pending' then
    raise exception 'Mark the request completed or dismissed' using errcode = '22023';
  end if;
  update public.company_member_requests
  set status = p_status, handled_by = (select auth.uid()), updated_at = now()
  where id = p_request_id;
end;
$$;

alter table public.company_member_requests enable row level security;
create policy "Staff can view member requests"
  on public.company_member_requests for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Company owners can view their member requests"
  on public.company_member_requests for select to authenticated
  using ((select private.is_company_owner(company_id)));

-- ---------------------------------------------------------------------------
-- Job requests
-- ---------------------------------------------------------------------------

create type public.job_request_status as enum ('submitted', 'in_review', 'converted', 'declined', 'cancelled');

create table public.job_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null,
  title text not null check (char_length(title) between 2 and 200),
  location text check (location is null or char_length(location) <= 200),
  work_arrangement public.work_arrangement,
  employment_type public.employment_type not null default 'direct_hire',
  openings integer not null default 1 check (openings between 1 and 100),
  salary_min numeric(12, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12, 2) check (salary_max is null or salary_max >= 0),
  target_start date,
  description text not null check (char_length(description) between 1 and 10000),
  must_have_skills text check (must_have_skills is null or char_length(must_have_skills) <= 1000),
  status public.job_request_status not null default 'submitted',
  -- Shown to the employer (e.g. why a request was declined).
  response_note text check (response_note is null or char_length(response_note) <= 2000),
  job_id uuid references public.jobs (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete cascade
);

create index job_requests_org_status_idx on public.job_requests (organization_id, status, created_at desc);
create index job_requests_company_idx on public.job_requests (company_id, created_at desc);

create function public.submit_job_request(
  p_company_id uuid,
  p_title text,
  p_location text,
  p_work_arrangement public.work_arrangement,
  p_employment_type public.employment_type,
  p_openings integer,
  p_salary_min numeric,
  p_salary_max numeric,
  p_target_start date,
  p_description text,
  p_must_have_skills text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if not private.is_company_member(p_company_id) then
    raise exception 'Only members of this company can request jobs' using errcode = '42501';
  end if;
  select organization_id into v_org from public.companies where id = p_company_id;

  -- Table constraints check lengths and ranges.
  insert into public.job_requests (
    organization_id, company_id, title, location, work_arrangement, employment_type, openings,
    salary_min, salary_max, target_start, description, must_have_skills, requested_by
  ) values (
    v_org, p_company_id, btrim(coalesce(p_title, '')), nullif(btrim(coalesce(p_location, '')), ''),
    p_work_arrangement, coalesce(p_employment_type, 'direct_hire'), coalesce(p_openings, 1),
    p_salary_min, p_salary_max, p_target_start, btrim(coalesce(p_description, '')),
    nullif(btrim(coalesce(p_must_have_skills, '')), ''), (select auth.uid())
  )
  returning id into v_id;

  perform private.write_audit(v_org, 'job_request.submitted', 'job_request', v_id::text, jsonb_build_object('company_id', p_company_id));
  return v_id;
end;
$$;

create function public.cancel_job_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select r.company_id, r.status into v_req from public.job_requests r where r.id = p_request_id for update;
  if not found or not private.is_company_member(v_req.company_id) then
    raise exception 'Job request not found' using errcode = 'P0002';
  end if;
  if v_req.status not in ('submitted', 'in_review') then
    raise exception 'This request is already closed' using errcode = '22023';
  end if;
  update public.job_requests set status = 'cancelled', updated_at = now() where id = p_request_id;
end;
$$;

create function public.review_job_request(
  p_request_id uuid,
  p_status public.job_request_status,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select r.organization_id, r.status into v_req from public.job_requests r where r.id = p_request_id for update;
  if not found or not private.is_staff(v_req.organization_id) then
    raise exception 'Job request not found' using errcode = 'P0002';
  end if;
  if p_status not in ('in_review', 'declined') then
    raise exception 'Mark the request in review or declined (use Convert to create a job)' using errcode = '22023';
  end if;
  if v_req.status not in ('submitted', 'in_review') then
    raise exception 'This request is already closed' using errcode = '22023';
  end if;
  if p_status = 'declined' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Tell the employer why the request is declined' using errcode = '22023';
  end if;
  update public.job_requests
  set status = p_status, response_note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_by = (select auth.uid()), updated_at = now()
  where id = p_request_id;
end;
$$;

-- Creates a draft job from the request (owned by the converting recruiter) and links it.
create function public.convert_job_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_req public.job_requests;
  v_job uuid;
begin
  select * into v_req from public.job_requests r where r.id = p_request_id for update;
  if not found or not private.is_staff(v_req.organization_id) then
    raise exception 'Job request not found' using errcode = 'P0002';
  end if;
  if v_req.status not in ('submitted', 'in_review') then
    raise exception 'This request is already closed' using errcode = '22023';
  end if;

  insert into public.jobs (
    organization_id, company_id, title, description, status, location, work_arrangement, employment_type,
    salary_min, salary_max, owner_id, created_by
  ) values (
    v_req.organization_id, v_req.company_id, v_req.title,
    left(v_req.description || case when v_req.must_have_skills is not null
      then E'\n\nMust-have skills (from the employer): ' || v_req.must_have_skills else '' end, 20000),
    'draft', v_req.location, v_req.work_arrangement, v_req.employment_type,
    v_req.salary_min, v_req.salary_max, v_actor, v_actor
  )
  returning id into v_job;

  update public.job_requests
  set status = 'converted', job_id = v_job, reviewed_by = v_actor, updated_at = now()
  where id = p_request_id;

  perform private.write_audit(v_req.organization_id, 'job_request.converted', 'job_request', p_request_id::text, jsonb_build_object('job_id', v_job));
  return v_job;
end;
$$;

alter table public.job_requests enable row level security;
create policy "Staff can view job requests"
  on public.job_requests for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Employers can view their company's job requests"
  on public.job_requests for select to authenticated
  using ((select private.is_company_member(company_id)));

-- ---------------------------------------------------------------------------
-- Submissions: employer responses, feedback and shared resumes
-- ---------------------------------------------------------------------------

alter table public.submissions
  add column shared_resume_id uuid references public.candidate_resumes (id) on delete set null,
  add column employer_responded_at timestamptz;

-- Submissions an employer can still act on (and see a shared resume for).
create function private.submission_is_open(p_status public.submission_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('submitted', 'under_review', 'interview_requested');
$$;

-- Staff choose which (if any) of the candidate's resumes the employer may open for this submission.
create function public.share_resume_with_submission(p_submission_id uuid, p_resume_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub record;
begin
  select s.organization_id, s.candidate_id into v_sub from public.submissions s where s.id = p_submission_id for update;
  if not found or not private.is_staff(v_sub.organization_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if p_resume_id is not null and not exists (
    select 1 from public.candidate_resumes r where r.id = p_resume_id and r.candidate_id = v_sub.candidate_id
  ) then
    raise exception 'That resume belongs to a different candidate' using errcode = '22023';
  end if;

  update public.submissions set shared_resume_id = p_resume_id where id = p_submission_id;
  perform private.write_audit(
    v_sub.organization_id, case when p_resume_id is null then 'submission.resume_unshared' else 'submission.resume_shared' end,
    'submission', p_submission_id::text, jsonb_build_object('resume_id', p_resume_id)
  );
end;
$$;

-- The shared resume's storage location, for an employer of the submission's company while it's open.
-- Each call is audited, since it precedes creating a download link.
create function public.get_shared_resume(p_submission_id uuid)
returns table (storage_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub record;
begin
  select s.organization_id, s.company_id, s.status, s.shared_resume_id into v_sub
  from public.submissions s where s.id = p_submission_id;
  if not found or not private.is_company_member(v_sub.company_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if v_sub.shared_resume_id is null or not private.submission_is_open(v_sub.status) then
    return;
  end if;

  perform private.write_audit(v_sub.organization_id, 'submission.resume_viewed', 'submission', p_submission_id::text, '{}'::jsonb);
  return query
    select r.storage_path, r.file_name from public.candidate_resumes r where r.id = v_sub.shared_resume_id;
end;
$$;

-- Storage read access for employers: only the one file shared with an open submission to their company.
create function private.can_employer_read_resume_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.submissions s
    join public.candidate_resumes r on r.id = s.shared_resume_id
    where r.storage_path = p_name
      and private.submission_is_open(s.status)
      and private.is_company_member(s.company_id)
  );
$$;

create policy "Employers can read resumes shared with their open submissions"
  on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (select private.can_employer_read_resume_object(name)));

create function public.respond_to_submission(p_submission_id uuid, p_status public.submission_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub record;
begin
  select s.organization_id, s.company_id, s.status into v_sub from public.submissions s where s.id = p_submission_id for update;
  if not found or not private.is_company_member(v_sub.company_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if p_status not in ('under_review', 'declined') then
    raise exception 'Choose under review or not moving forward (use Request interview to ask for one)' using errcode = '22023';
  end if;
  if not private.submission_is_open(v_sub.status) then
    raise exception 'This submission is closed' using errcode = '22023';
  end if;
  if v_sub.status = p_status then
    return;
  end if;

  update public.submissions set status = p_status, employer_responded_at = now() where id = p_submission_id;
  perform private.write_audit(
    v_sub.organization_id, 'submission.employer_response', 'submission', p_submission_id::text,
    jsonb_build_object('from', v_sub.status, 'to', p_status)
  );
end;
$$;

-- Employer feedback is for CoreTech staff and the employer's own team — never shown to the candidate.
create table public.submission_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  rating smallint check (rating is null or rating between 1 and 5),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index submission_feedback_submission_idx on public.submission_feedback (submission_id, created_at);

create function public.add_submission_feedback(p_submission_id uuid, p_rating smallint, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub record;
  v_id uuid;
begin
  select s.organization_id, s.company_id into v_sub from public.submissions s where s.id = p_submission_id;
  if not found or not private.is_company_member(v_sub.company_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  insert into public.submission_feedback (organization_id, submission_id, company_id, author_id, rating, body)
  values (v_sub.organization_id, p_submission_id, v_sub.company_id, (select auth.uid()), p_rating, btrim(coalesce(p_body, '')))
  returning id into v_id;
  return v_id;
end;
$$;

alter table public.submission_feedback enable row level security;
create policy "Staff can view submission feedback"
  on public.submission_feedback for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Employers can view feedback on their company's submissions"
  on public.submission_feedback for select to authenticated
  using ((select private.is_company_member(company_id)));

-- Author names on feedback (employers can't read other profiles directly).
create function public.submission_feedback_with_authors(p_submission_id uuid)
returns table (id uuid, rating smallint, body text, created_at timestamptz, author_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.rating, f.body, f.created_at, coalesce(p.full_name, p.email, 'Former team member')
  from public.submission_feedback f
  left join public.profiles p on p.id = f.author_id
  where f.submission_id = p_submission_id
    and (private.is_company_member(f.company_id) or private.is_staff(f.organization_id))
  order by f.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Interview requests
-- ---------------------------------------------------------------------------

create type public.interview_format as enum ('video', 'phone', 'onsite');
create type public.interview_request_status as enum ('requested', 'scheduled', 'declined', 'cancelled');

create table public.interview_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  format public.interview_format not null,
  duration_minutes integer not null check (duration_minutes between 15 and 480),
  timezone text not null check (char_length(timezone) between 1 and 64),
  -- Up to three proposed start times.
  proposed_times timestamptz[] not null check (cardinality(proposed_times) between 1 and 3),
  interviewers text check (interviewers is null or char_length(interviewers) <= 500),
  notes text check (notes is null or char_length(notes) <= 2000),
  status public.interview_request_status not null default 'requested',
  confirmed_time timestamptz,
  -- Shown to the employer.
  response_note text check (response_note is null or char_length(response_note) <= 2000),
  requested_by uuid references public.profiles (id) on delete set null,
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'scheduled' or confirmed_time is not null)
);

create index interview_requests_submission_idx on public.interview_requests (submission_id, created_at desc);
create index interview_requests_org_status_idx on public.interview_requests (organization_id, status);
create unique index interview_requests_one_open_idx
  on public.interview_requests (submission_id) where status = 'requested';

create function public.request_interview(
  p_submission_id uuid,
  p_format public.interview_format,
  p_duration_minutes integer,
  p_timezone text,
  p_proposed_times timestamptz[],
  p_interviewers text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub record;
  v_id uuid;
begin
  select s.organization_id, s.company_id, s.status into v_sub from public.submissions s where s.id = p_submission_id for update;
  if not found or not private.is_company_member(v_sub.company_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if not private.submission_is_open(v_sub.status) then
    raise exception 'This submission is closed' using errcode = '22023';
  end if;
  if p_proposed_times is null or exists (select 1 from unnest(p_proposed_times) t where t <= now()) then
    raise exception 'Propose times in the future' using errcode = '22023';
  end if;

  begin
    insert into public.interview_requests (
      organization_id, submission_id, company_id, format, duration_minutes, timezone, proposed_times,
      interviewers, notes, requested_by
    ) values (
      v_sub.organization_id, p_submission_id, v_sub.company_id, p_format, p_duration_minutes, btrim(coalesce(p_timezone, '')),
      p_proposed_times, nullif(btrim(coalesce(p_interviewers, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
      (select auth.uid())
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'An interview request for this candidate is already waiting for CoreTech' using errcode = '23505';
  end;

  update public.submissions
  set status = 'interview_requested', employer_responded_at = now()
  where id = p_submission_id and status <> 'interview_requested';

  perform private.write_audit(v_sub.organization_id, 'interview.requested', 'submission', p_submission_id::text, jsonb_build_object('request_id', v_id));
  return v_id;
end;
$$;

create function public.cancel_interview_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select r.company_id, r.status into v_req from public.interview_requests r where r.id = p_request_id for update;
  if not found or not private.is_company_member(v_req.company_id) then
    raise exception 'Interview request not found' using errcode = 'P0002';
  end if;
  if v_req.status not in ('requested', 'scheduled') then
    raise exception 'This interview request is already closed' using errcode = '22023';
  end if;
  update public.interview_requests set status = 'cancelled', updated_at = now() where id = p_request_id;
end;
$$;

create function public.handle_interview_request(
  p_request_id uuid,
  p_status public.interview_request_status,
  p_confirmed_time timestamptz,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select r.organization_id, r.status, r.proposed_times into v_req from public.interview_requests r where r.id = p_request_id for update;
  if not found or not private.is_staff(v_req.organization_id) then
    raise exception 'Interview request not found' using errcode = 'P0002';
  end if;
  if p_status not in ('scheduled', 'declined') then
    raise exception 'Mark the request scheduled or declined' using errcode = '22023';
  end if;
  if v_req.status <> 'requested' then
    raise exception 'This interview request has already been handled' using errcode = '22023';
  end if;
  if p_status = 'scheduled' and p_confirmed_time is null then
    raise exception 'Choose the confirmed time' using errcode = '22023';
  end if;
  if p_status = 'declined' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Tell the employer why' using errcode = '22023';
  end if;

  update public.interview_requests
  set status = p_status,
      confirmed_time = case when p_status = 'scheduled' then p_confirmed_time end,
      response_note = nullif(btrim(coalesce(p_note, '')), ''),
      handled_by = (select auth.uid()),
      updated_at = now()
  where id = p_request_id;
end;
$$;

alter table public.interview_requests enable row level security;
create policy "Staff can view interview requests"
  on public.interview_requests for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Employers can view their company's interview requests"
  on public.interview_requests for select to authenticated
  using ((select private.is_company_member(company_id)));

-- ---------------------------------------------------------------------------
-- Privileges: read-only tables; every write goes through the functions above
-- ---------------------------------------------------------------------------

revoke all on public.company_member_requests, public.job_requests, public.submission_feedback, public.interview_requests
  from anon, authenticated;
grant select on public.company_member_requests, public.job_requests, public.submission_feedback, public.interview_requests
  to authenticated;

revoke all on function
  private.is_company_owner(uuid),
  private.submission_is_open(public.submission_status),
  private.can_employer_read_resume_object(text),
  public.update_my_company(uuid, text, text, text, text),
  public.company_team(uuid),
  public.set_company_member_role_as_owner(uuid, uuid, public.company_member_role),
  public.remove_company_member_as_owner(uuid, uuid),
  public.request_company_member(uuid, text, text, public.company_member_role),
  public.handle_company_member_request(uuid, public.member_request_status),
  public.submit_job_request(uuid, text, text, public.work_arrangement, public.employment_type, integer, numeric, numeric, date, text, text),
  public.cancel_job_request(uuid),
  public.review_job_request(uuid, public.job_request_status, text),
  public.convert_job_request(uuid),
  public.share_resume_with_submission(uuid, uuid),
  public.get_shared_resume(uuid),
  public.respond_to_submission(uuid, public.submission_status),
  public.add_submission_feedback(uuid, smallint, text),
  public.submission_feedback_with_authors(uuid),
  public.request_interview(uuid, public.interview_format, integer, text, timestamptz[], text, text),
  public.cancel_interview_request(uuid),
  public.handle_interview_request(uuid, public.interview_request_status, timestamptz, text)
  from public, anon, authenticated;

grant execute on function
  private.is_company_owner(uuid),
  private.submission_is_open(public.submission_status),
  private.can_employer_read_resume_object(text),
  public.update_my_company(uuid, text, text, text, text),
  public.company_team(uuid),
  public.set_company_member_role_as_owner(uuid, uuid, public.company_member_role),
  public.remove_company_member_as_owner(uuid, uuid),
  public.request_company_member(uuid, text, text, public.company_member_role),
  public.handle_company_member_request(uuid, public.member_request_status),
  public.submit_job_request(uuid, text, text, public.work_arrangement, public.employment_type, integer, numeric, numeric, date, text, text),
  public.cancel_job_request(uuid),
  public.review_job_request(uuid, public.job_request_status, text),
  public.convert_job_request(uuid),
  public.share_resume_with_submission(uuid, uuid),
  public.get_shared_resume(uuid),
  public.respond_to_submission(uuid, public.submission_status),
  public.add_submission_feedback(uuid, smallint, text),
  public.submission_feedback_with_authors(uuid),
  public.request_interview(uuid, public.interview_format, integer, text, timestamptz[], text, text),
  public.cancel_interview_request(uuid),
  public.handle_interview_request(uuid, public.interview_request_status, timestamptz, text)
  to authenticated;

-- ===== 20261105000001_interviews.sql =====
-- Phase 9: interview management and notifications.
--
--   * interviews: one scheduled conversation for an application (recruiter screen, technical, client,
--     final), with time zone, format, meeting link or location, interviewers, status and outcome.
--     Written only through SECURITY DEFINER functions; every change lands in interview_events.
--   * Candidates see their own interviews through my_interviews() (no internal outcome or feedback).
--   * Employers see client interviews for their company's submissions through company_interviews(), and
--     may leave feedback on them. Staff see everything.
--   * Email attempts are logged in notification_deliveries via log_interview_email(); "sent" means the
--     provider accepted the message, never proof that it reached an inbox.

create type public.interview_kind as enum ('recruiter_screen', 'technical', 'client', 'final', 'other');
create type public.interview_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');
create type public.interview_outcome as enum ('advance', 'hold', 'decline');
create type public.interview_recommendation as enum ('strong_yes', 'yes', 'no', 'strong_no');

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  application_id uuid not null,
  candidate_id uuid not null,
  job_id uuid not null,
  company_id uuid not null references public.companies (id),
  -- Set for client-facing interviews tied to a submission; only those are visible to the employer.
  submission_id uuid references public.submissions (id) on delete set null,
  interview_request_id uuid references public.interview_requests (id) on delete set null,
  kind public.interview_kind not null,
  format public.interview_format not null,
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 480),
  timezone text not null check (char_length(timezone) between 1 and 64),
  meeting_url text check (meeting_url is null or (char_length(meeting_url) <= 500 and meeting_url ~* '^https://')),
  location text check (location is null or char_length(location) <= 300),
  interviewers text check (interviewers is null or char_length(interviewers) <= 500),
  -- Shown to the candidate (and employer for client interviews).
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  status public.interview_status not null default 'scheduled',
  outcome public.interview_outcome,
  -- Internal: staff only.
  outcome_summary text check (outcome_summary is null or char_length(outcome_summary) <= 2000),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (format <> 'video' or meeting_url is not null),
  check (format <> 'onsite' or location is not null),
  foreign key (application_id, organization_id)
    references public.applications (id, organization_id) on delete cascade
);

create index interviews_org_starts_idx on public.interviews (organization_id, starts_at);
create index interviews_application_idx on public.interviews (application_id, starts_at desc);
create index interviews_company_idx on public.interviews (company_id, starts_at);

-- Append-only history of every scheduling change. Staff only.
create table public.interview_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  interview_id uuid not null references public.interviews (id) on delete cascade,
  action text not null check (action in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'no_show')),
  from_starts_at timestamptz,
  to_starts_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 1000),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index interview_events_interview_idx on public.interview_events (interview_id, id);

create table public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  interview_id uuid not null references public.interviews (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null check (author_kind in ('staff', 'employer')),
  rating smallint check (rating is null or rating between 1 and 5),
  recommendation public.interview_recommendation,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index interview_feedback_interview_idx on public.interview_feedback (interview_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.check_interview_details(
  p_format public.interview_format,
  p_starts_at timestamptz,
  p_timezone text,
  p_meeting_url text,
  p_location text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'Choose a start time in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if p_format = 'video' and nullif(btrim(coalesce(p_meeting_url, '')), '') is null then
    raise exception 'Add the meeting link for a video interview' using errcode = '22023';
  end if;
  if p_format = 'onsite' and nullif(btrim(coalesce(p_location, '')), '') is null then
    raise exception 'Add the address for an on-site interview' using errcode = '22023';
  end if;
end;
$$;

create function private.log_interview_event(
  p_interview public.interviews,
  p_action text,
  p_from timestamptz,
  p_to timestamptz,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.interview_events (organization_id, interview_id, action, from_starts_at, to_starts_at, reason, actor_id)
  values (p_interview.organization_id, p_interview.id, p_action, p_from, p_to, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Staff functions
-- ---------------------------------------------------------------------------

create function public.schedule_interview(
  p_application_id uuid,
  p_kind public.interview_kind,
  p_format public.interview_format,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_timezone text,
  p_meeting_url text,
  p_location text,
  p_interviewers text,
  p_instructions text,
  p_interview_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_app record;
  v_submission uuid;
  v_id uuid;
  v_row public.interviews;
begin
  select a.id, a.organization_id, a.candidate_id, a.job_id, a.status, j.company_id into v_app
  from public.applications a join public.jobs j on j.id = a.job_id
  where a.id = p_application_id;
  if not found or not private.is_staff(v_app.organization_id) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if v_app.status <> 'active' then
    raise exception 'Interviews can only be scheduled for active applications' using errcode = '22023';
  end if;
  perform private.check_interview_details(p_format, p_starts_at, p_timezone, p_meeting_url, p_location);

  -- Client interviews are shared with the employer through the open submission for this job.
  if p_kind in ('client', 'final') then
    select s.id into v_submission from public.submissions s
    where s.candidate_id = v_app.candidate_id and s.job_id = v_app.job_id
      and s.status in ('submitted', 'under_review', 'interview_requested')
    order by s.created_at desc limit 1;
    if v_submission is null and p_kind = 'client' then
      raise exception 'Submit the candidate to the employer before scheduling a client interview' using errcode = '22023';
    end if;
  end if;

  if p_interview_request_id is not null and not exists (
    select 1 from public.interview_requests r
    where r.id = p_interview_request_id and r.submission_id = v_submission and r.status = 'requested'
  ) then
    raise exception 'That interview request is not waiting for this candidate' using errcode = '22023';
  end if;

  insert into public.interviews (
    organization_id, application_id, candidate_id, job_id, company_id, submission_id, interview_request_id,
    kind, format, starts_at, duration_minutes, timezone, meeting_url, location, interviewers, instructions, created_by
  ) values (
    v_app.organization_id, p_application_id, v_app.candidate_id, v_app.job_id, v_app.company_id, v_submission,
    p_interview_request_id, p_kind, p_format, p_starts_at, p_duration_minutes, p_timezone,
    nullif(btrim(coalesce(p_meeting_url, '')), ''), nullif(btrim(coalesce(p_location, '')), ''),
    nullif(btrim(coalesce(p_interviewers, '')), ''), nullif(btrim(coalesce(p_instructions, '')), ''), v_actor
  )
  returning * into v_row;
  v_id := v_row.id;

  if p_interview_request_id is not null then
    update public.interview_requests
    set status = 'scheduled', confirmed_time = p_starts_at, handled_by = v_actor, updated_at = now()
    where id = p_interview_request_id;
  end if;

  perform private.log_interview_event(v_row, 'scheduled', null, p_starts_at, null);
  return v_id;
end;
$$;

create function public.reschedule_interview(
  p_interview_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_timezone text,
  p_meeting_url text,
  p_location text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.interviews;
begin
  select * into v_row from public.interviews where id = p_interview_id for update;
  if not found or not private.is_staff(v_row.organization_id) then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'scheduled' then
    raise exception 'Only scheduled interviews can be rescheduled' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Give a reason for rescheduling' using errcode = '22023';
  end if;
  perform private.check_interview_details(v_row.format, p_starts_at, p_timezone, p_meeting_url, p_location);

  update public.interviews
  set starts_at = p_starts_at,
      duration_minutes = coalesce(p_duration_minutes, duration_minutes),
      timezone = p_timezone,
      meeting_url = nullif(btrim(coalesce(p_meeting_url, '')), ''),
      location = nullif(btrim(coalesce(p_location, '')), ''),
      updated_at = now()
  where id = p_interview_id;

  if v_row.interview_request_id is not null then
    update public.interview_requests set confirmed_time = p_starts_at, updated_at = now() where id = v_row.interview_request_id;
  end if;

  perform private.log_interview_event(v_row, 'rescheduled', v_row.starts_at, p_starts_at, p_reason);
end;
$$;

create function public.cancel_scheduled_interview(p_interview_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.interviews;
begin
  select * into v_row from public.interviews where id = p_interview_id for update;
  if not found or not private.is_staff(v_row.organization_id) then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'scheduled' then
    raise exception 'Only scheduled interviews can be cancelled' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Give a reason for cancelling' using errcode = '22023';
  end if;

  update public.interviews set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = p_interview_id;
  if v_row.interview_request_id is not null then
    update public.interview_requests set status = 'cancelled', updated_at = now() where id = v_row.interview_request_id;
  end if;
  perform private.log_interview_event(v_row, 'cancelled', v_row.starts_at, null, p_reason);
end;
$$;

-- Outcome is a recruiter's record of what happened; it never moves the pipeline or rejects anyone by itself.
create function public.record_interview_outcome(
  p_interview_id uuid,
  p_status public.interview_status,
  p_outcome public.interview_outcome,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.interviews;
begin
  select * into v_row from public.interviews where id = p_interview_id for update;
  if not found or not private.is_staff(v_row.organization_id) then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  if p_status not in ('completed', 'no_show') then
    raise exception 'Record the interview as completed or no-show' using errcode = '22023';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'This interview was cancelled' using errcode = '22023';
  end if;
  if v_row.starts_at > now() then
    raise exception 'This interview hasn''t started yet' using errcode = '22023';
  end if;
  if p_status = 'no_show' and p_outcome is not null then
    raise exception 'A no-show has no outcome' using errcode = '22023';
  end if;

  update public.interviews
  set status = p_status, outcome = p_outcome,
      outcome_summary = nullif(btrim(coalesce(p_summary, '')), ''), updated_at = now()
  where id = p_interview_id;
  if v_row.status <> p_status then
    perform private.log_interview_event(v_row, p_status::text, v_row.starts_at, null, null);
  end if;
end;
$$;

-- Records one email attempt about an interview. Called by the server after the provider responds.
create function public.log_interview_email(
  p_interview_id uuid,
  p_recipient text,
  p_subject text,
  p_status text,
  p_provider_message_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.interviews where id = p_interview_id;
  if v_org is null or not private.is_staff(v_org) then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  insert into public.notification_deliveries (organization_id, channel, recipient, subject, related_type, related_id, status, provider_message_id, error)
  values (v_org, 'email', left(p_recipient, 320), left(p_subject, 300), 'interview', p_interview_id::text, p_status,
          left(p_provider_message_id, 200), left(p_error, 1000));
end;
$$;

-- ---------------------------------------------------------------------------
-- Feedback (staff and, for client interviews, the employer)
-- ---------------------------------------------------------------------------

create function public.add_interview_feedback(
  p_interview_id uuid,
  p_rating smallint,
  p_recommendation public.interview_recommendation,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.interviews;
  v_kind text;
  v_id uuid;
begin
  select * into v_row from public.interviews where id = p_interview_id;
  if not found then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  if private.is_staff(v_row.organization_id) then
    v_kind := 'staff';
  elsif v_row.submission_id is not null and private.is_company_member(v_row.company_id) then
    v_kind := 'employer';
  else
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'This interview was cancelled' using errcode = '22023';
  end if;

  insert into public.interview_feedback (organization_id, interview_id, company_id, author_id, author_kind, rating, recommendation, body)
  values (v_row.organization_id, p_interview_id, v_row.company_id, (select auth.uid()), v_kind, p_rating, p_recommendation, btrim(coalesce(p_body, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.interview_feedback_with_authors(p_interview_id uuid)
returns table (id uuid, author_kind text, rating smallint, recommendation public.interview_recommendation, body text, created_at timestamptz, author_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.author_kind, f.rating, f.recommendation, f.body, f.created_at, coalesce(p.full_name, p.email, 'Former user')
  from public.interview_feedback f
  join public.interviews i on i.id = f.interview_id
  left join public.profiles p on p.id = f.author_id
  where f.interview_id = p_interview_id
    and (private.is_staff(i.organization_id) or (i.submission_id is not null and private.is_company_member(i.company_id)))
  order by f.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Candidate and employer views (approved columns only)
-- ---------------------------------------------------------------------------

create function public.my_interviews()
returns table (
  id uuid, job_title text, company_name text, kind public.interview_kind, format public.interview_format,
  starts_at timestamptz, duration_minutes integer, timezone text, meeting_url text, location text,
  instructions text, status public.interview_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, j.title,
         case when i.kind in ('client', 'final') then c.name end,
         i.kind, i.format, i.starts_at, i.duration_minutes, i.timezone, i.meeting_url, i.location, i.instructions, i.status
  from public.interviews i
  join public.jobs j on j.id = i.job_id
  join public.companies c on c.id = i.company_id
  where private.is_own_candidate(i.candidate_id)
  order by i.starts_at desc;
$$;

create function public.company_interviews(p_company_id uuid)
returns table (
  id uuid, submission_id uuid, candidate_display_name text, job_title text, kind public.interview_kind,
  format public.interview_format, starts_at timestamptz, duration_minutes integer, timezone text,
  meeting_url text, location text, interviewers text, instructions text, status public.interview_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.submission_id, s.candidate_display_name, j.title, i.kind, i.format, i.starts_at, i.duration_minutes,
         i.timezone, i.meeting_url, i.location, i.interviewers, i.instructions, i.status
  from public.interviews i
  join public.submissions s on s.id = i.submission_id
  join public.jobs j on j.id = i.job_id
  where i.company_id = p_company_id
    and private.is_company_member(p_company_id)
  order by i.starts_at desc;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.interviews enable row level security;
alter table public.interview_events enable row level security;
alter table public.interview_feedback enable row level security;

create policy "Staff can view interviews" on public.interviews for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can view interview history" on public.interview_events for select to authenticated
  using ((select private.is_staff(organization_id)));
create policy "Staff can view interview feedback" on public.interview_feedback for select to authenticated
  using ((select private.is_staff(organization_id)));

revoke all on public.interviews, public.interview_events, public.interview_feedback from anon, authenticated;
grant select on public.interviews, public.interview_events, public.interview_feedback to authenticated;

revoke all on function
  private.check_interview_details(public.interview_format, timestamptz, text, text, text),
  private.log_interview_event(public.interviews, text, timestamptz, timestamptz, text),
  public.schedule_interview(uuid, public.interview_kind, public.interview_format, timestamptz, integer, text, text, text, text, text, uuid),
  public.reschedule_interview(uuid, timestamptz, integer, text, text, text, text),
  public.cancel_scheduled_interview(uuid, text),
  public.record_interview_outcome(uuid, public.interview_status, public.interview_outcome, text),
  public.log_interview_email(uuid, text, text, text, text, text),
  public.add_interview_feedback(uuid, smallint, public.interview_recommendation, text),
  public.interview_feedback_with_authors(uuid),
  public.my_interviews(),
  public.company_interviews(uuid)
  from public, anon, authenticated;

grant execute on function
  public.schedule_interview(uuid, public.interview_kind, public.interview_format, timestamptz, integer, text, text, text, text, text, uuid),
  public.reschedule_interview(uuid, timestamptz, integer, text, text, text, text),
  public.cancel_scheduled_interview(uuid, text),
  public.record_interview_outcome(uuid, public.interview_status, public.interview_outcome, text),
  public.log_interview_email(uuid, text, text, text, text, text),
  public.add_interview_feedback(uuid, smallint, public.interview_recommendation, text),
  public.interview_feedback_with_authors(uuid),
  public.my_interviews(),
  public.company_interviews(uuid)
  to authenticated;

-- ===== 20261106000001_direct_hire_finance.sql =====
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

-- ===== 20261108000001_contract_staffing.sql =====
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

-- ===== 20261109000001_ai_resume_parsing.sql =====
-- Phase 12: AI resume parsing (assistive only).
--
--   * resume_parses: one row per AI request — who asked, which resume, provider/model, token usage, the
--     PROPOSED fields (never applied automatically) and the outcome. Staff only.
--   * begin_resume_parse() enforces rate and cost limits *before* the provider is called:
--       - per person: at most p_hourly_limit requests in the last hour
--       - organization: at most p_monthly_limit requests and p_monthly_token_budget tokens this month
--     Failed calls count too, so retries can't run up costs.
--   * finish_resume_parse() records the result or failure; review_resume_parse() records the recruiter's
--     decision (applied / discarded). Applying writes to the normal candidate tables through the app,
--     under the same RLS as manual entry.
--
-- No protected characteristics are requested or stored: the proposal has no fields for age, dates of
-- birth, graduation years, gender, race, religion, nationality, marital status, disability or photos.

create type public.resume_parse_status as enum ('pending', 'proposed', 'failed', 'applied', 'discarded');

create table public.resume_parses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  resume_id uuid references public.candidate_resumes (id) on delete set null,
  status public.resume_parse_status not null default 'pending',
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 100),
  input_chars integer not null check (input_chars >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  proposal jsonb,
  error text check (error is null or char_length(error) <= 500),
  applied_summary jsonb,
  requested_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  reviewed_at timestamptz,
  foreign key (candidate_id, organization_id) references public.candidates (id, organization_id) on delete cascade
);

create index resume_parses_candidate_idx on public.resume_parses (candidate_id, created_at desc);
create index resume_parses_org_created_idx on public.resume_parses (organization_id, created_at desc);
create index resume_parses_requester_idx on public.resume_parses (requested_by, created_at desc);

create function public.begin_resume_parse(
  p_candidate_id uuid,
  p_resume_id uuid,
  p_provider text,
  p_model text,
  p_input_chars integer,
  p_hourly_limit integer,
  p_monthly_limit integer,
  p_monthly_token_budget integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_recent integer;
  v_month_count integer;
  v_month_tokens bigint;
  v_id uuid;
begin
  select organization_id into v_org from public.candidates where id = p_candidate_id;
  if v_org is null or not private.is_staff(v_org) then
    raise exception 'Candidate not found' using errcode = 'P0002';
  end if;
  if p_resume_id is not null and not exists (
    select 1 from public.candidate_resumes where id = p_resume_id and candidate_id = p_candidate_id
  ) then
    raise exception 'That resume belongs to a different candidate' using errcode = '22023';
  end if;

  -- Serialize limit checks per organization so concurrent requests can't both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('resume_parse:' || v_org::text));

  select count(*) into v_recent from public.resume_parses
  where requested_by = v_actor and created_at > now() - interval '1 hour';
  if v_recent >= greatest(coalesce(p_hourly_limit, 10), 0) then
    raise exception 'You''ve reached the hourly limit for AI parsing. Try again later.' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)
    into v_month_count, v_month_tokens
  from public.resume_parses
  where organization_id = v_org and created_at >= date_trunc('month', now());
  if v_month_count >= greatest(coalesce(p_monthly_limit, 200), 0) then
    raise exception 'The monthly AI parsing limit has been reached. An administrator can raise AI_MONTHLY_PARSE_LIMIT.' using errcode = '22023';
  end if;
  if p_monthly_token_budget is not null and v_month_tokens >= p_monthly_token_budget then
    raise exception 'The monthly AI token budget has been used. An administrator can raise AI_MONTHLY_TOKEN_BUDGET.' using errcode = '22023';
  end if;

  insert into public.resume_parses (organization_id, candidate_id, resume_id, provider, model, input_chars, requested_by)
  values (v_org, p_candidate_id, p_resume_id, left(p_provider, 40), left(p_model, 100), greatest(coalesce(p_input_chars, 0), 0), v_actor)
  returning id into v_id;

  perform private.write_audit(v_org, 'ai.resume_parse_requested', 'candidate', p_candidate_id::text,
    jsonb_build_object('parse_id', v_id, 'provider', p_provider, 'model', p_model, 'input_chars', p_input_chars));
  return v_id;
end;
$$;

create function public.finish_resume_parse(
  p_parse_id uuid,
  p_proposal jsonb,
  p_input_tokens integer,
  p_output_tokens integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.resume_parses;
begin
  select * into v_p from public.resume_parses where id = p_parse_id for update;
  if not found or v_p.requested_by is distinct from (select auth.uid()) or v_p.status <> 'pending' then
    raise exception 'Parse not found' using errcode = 'P0002';
  end if;
  update public.resume_parses
  set status = case when p_error is null and p_proposal is not null then 'proposed' else 'failed' end::public.resume_parse_status,
      proposal = case when p_error is null then p_proposal end,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      error = left(p_error, 500),
      finished_at = now()
  where id = p_parse_id;
end;
$$;

create function public.review_resume_parse(p_parse_id uuid, p_status public.resume_parse_status, p_applied_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.resume_parses;
begin
  select * into v_p from public.resume_parses where id = p_parse_id for update;
  if not found or not private.is_staff(v_p.organization_id) then
    raise exception 'Parse not found' using errcode = 'P0002';
  end if;
  if v_p.status <> 'proposed' then
    raise exception 'This suggestion was already reviewed' using errcode = '22023';
  end if;
  if p_status not in ('applied', 'discarded') then
    raise exception 'Choose applied or discarded' using errcode = '22023';
  end if;
  update public.resume_parses
  set status = p_status, applied_summary = p_applied_summary, reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_parse_id;
  perform private.write_audit(v_p.organization_id, 'ai.resume_parse_' || p_status::text, 'candidate', v_p.candidate_id::text,
    jsonb_build_object('parse_id', p_parse_id, 'applied', p_applied_summary));
end;
$$;

-- Usage this month, for the settings banner.
create function public.ai_usage_this_month()
returns table (requests integer, failed integer, tokens bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, (count(*) filter (where status = 'failed'))::integer,
         coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)
  from public.resume_parses
  where organization_id = private.my_org() and private.is_staff(organization_id) and created_at >= date_trunc('month', now());
$$;

alter table public.resume_parses enable row level security;
create policy "Staff can view resume parses" on public.resume_parses for select to authenticated
  using ((select private.is_staff(organization_id)));

revoke all on public.resume_parses from anon, authenticated;
grant select on public.resume_parses to authenticated;

revoke all on function
  public.begin_resume_parse(uuid, uuid, text, text, integer, integer, integer, integer),
  public.finish_resume_parse(uuid, jsonb, integer, integer, text),
  public.review_resume_parse(uuid, public.resume_parse_status, jsonb),
  public.ai_usage_this_month()
  from public, anon, authenticated;
grant execute on function
  public.begin_resume_parse(uuid, uuid, text, text, integer, integer, integer, integer),
  public.finish_resume_parse(uuid, jsonb, integer, integer, text),
  public.review_resume_parse(uuid, public.resume_parse_status, jsonb),
  public.ai_usage_this_month()
  to authenticated;

-- ===== 20261110000001_security_hardening.sql =====
-- Phase 13: security hardening from the audit (docs/SECURITY_AUDIT.md).
--
-- 1. Submissions are written only through submit_application_to_client() (records consent) and the
--    other submission functions. Staff no longer have a direct INSERT/UPDATE path that could skip the
--    consent check or point shared_resume_id at another candidate's resume.
-- 2. Candidates no longer read their raw candidates / applications rows (which include recruiter-only
--    tags, owner, source and internal pipeline stages). They use my_candidate_profile() and
--    my_applications(), which return approved columns only. Applying stays in apply_to_job().

-- 1 ---------------------------------------------------------------------------

drop policy "Staff can create submissions as themselves" on public.submissions;
drop policy "Staff can update submissions" on public.submissions;
revoke insert, update on public.submissions from authenticated;

-- 2 ---------------------------------------------------------------------------

drop policy "Candidates can view their own record" on public.candidates;
drop policy "Candidates can view their own applications" on public.applications;
drop policy "Candidates can apply to published jobs as themselves" on public.applications;

create function public.my_candidate_profile()
returns table (
  id uuid, organization_id uuid, first_name text, last_name text, email text, phone text,
  location text, headline text, summary text, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.organization_id, c.first_name, c.last_name, c.email, c.phone, c.location, c.headline, c.summary, c.updated_at
  from public.candidates c
  where c.user_id = (select auth.uid()) and private.is_own_candidate(c.id);
$$;

revoke all on function public.my_candidate_profile() from public, anon, authenticated;
grant execute on function public.my_candidate_profile() to authenticated;

-- ===== One-off: provision accounts that signed up before these tables existed =====
-- The signup trigger only fires for new users, so create the missing profiles here.
-- The project owner's account becomes the first administrator; anyone else gets the candidate role.
insert into public.profiles (id, organization_id, email, full_name)
select u.id, o.id, coalesce(u.email, ''),
       nullif(left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 200), '')
from auth.users u
cross join (select id from public.organizations where is_default) o
where not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.user_roles (user_id, organization_id, role)
select p.id, p.organization_id,
       case when lower(p.email) = 'ameer.jasim1987@gmail.com' then 'admin' else 'candidate' end::public.app_role
from public.profiles p
where not exists (select 1 from public.user_roles r where r.user_id = p.id);
