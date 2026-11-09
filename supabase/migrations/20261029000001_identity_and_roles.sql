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
