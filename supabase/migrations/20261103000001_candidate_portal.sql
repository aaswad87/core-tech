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
