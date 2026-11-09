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
