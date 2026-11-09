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
