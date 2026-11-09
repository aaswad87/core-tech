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
