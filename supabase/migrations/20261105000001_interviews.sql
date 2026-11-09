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
