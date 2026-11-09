-- CoreTech Phase 12 update (AI resume parsing log and limits). Run once in the Supabase SQL editor, after the Phase 9, 10 and 11 updates.

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
