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
