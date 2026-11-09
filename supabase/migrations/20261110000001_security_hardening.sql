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
