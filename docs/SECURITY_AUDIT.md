# CoreTech Recruiting — Security & QA audit (Phase 13)

Date: 2026-11-10. Scope: the whole app as of Phase 12 — database (13 migrations), server actions, route
handlers, configuration, headers, public pages. Severity uses Critical / High / Medium / Low.

## Summary

No critical findings. Three medium findings were fixed; low-risk items and things that can only be verified
on the live deployment are listed under **Remaining risks**.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Candidates could read their whole `candidates` row (recruiter-only tags, owner, source) and raw `applications` rows (internal pipeline stages such as "On hold") with browser tools, though the portal never showed them | Medium | **Fixed** — migration `20261110000001`: raw-row policies dropped; candidates use `my_candidate_profile()` and `my_applications()` (approved columns only); applying only via `apply_to_job()` |
| 2 | Staff had a direct INSERT/UPDATE path on `submissions` that could skip the candidate-consent check or point `shared_resume_id` at another candidate's resume | Medium | **Fixed** — same migration: direct writes revoked; all submission changes go through the audited functions |
| 3 | No Content-Security-Policy or HSTS header | Medium | **Fixed** — `next.config.ts`: CSP (scripts/styles/images/connections limited to this site, Supabase and Unsplash; no framing; no plugins; forms post only to this site) and HSTS + `upgrade-insecure-requests` when the site URL is `https://` |
| 4 | No error page for unexpected failures (users would see the framework default) | Low | **Fixed** — `src/app/error.tsx`, `src/app/global-error.tsx` (never show internal error text; show a reference id) |
| 5 | Staff can link a candidate record to any portal account (`candidates.user_id`) | Low | Accepted — staff already see all candidate data; after fix 1 a wrongly linked account only sees approved profile fields. Documented. |
| 6 | Candidates can see their own `submissions` rows, including the employer's status (e.g. "declined") before a recruiter has spoken to them | Low | Accepted for transparency; revisit if recruiters want to break news personally |
| 7 | Employers can read their own jobs' internal `description` and salary range | Low | Accepted — it's the employer's own job data |

## What was checked

### Database (automated, `tests/db/security-invariants.test.ts`, runs on every test run)
- Row Level Security is on for **every** public table.
- Anonymous visitors have **no** table privileges and can call only `get_published_jobs()` / `get_published_job()`.
- Every `SECURITY DEFINER` function pins `search_path`.
- Direct write grants are limited to a reviewed list; everything else (submissions, interviews, finance,
  contracts, privacy requests, preferences, AI logs) is written only through functions.
- Every insert/update policy has a `WITH CHECK`; every policy applies to signed-in users only.
- Storage policies all target the private `resumes` bucket, which is not public.

### Access control & isolation (existing per-feature suites, 160+ database tests)
- Role escalation: users can't grant themselves roles; only `assign_role`/`revoke_role` by an admin (never self).
- IDOR: every function re-checks the caller against the record's organization/company/candidate; other people's
  ids return "not found".
- Employer isolation: two-company tests for jobs, submissions, resumes, feedback, interviews, timesheets, team.
- Candidate privacy: notes, activity, stage history, feedback, interview outcomes, finance and contract data are
  never visible to candidates.
- Finance and contract data: admin-only; recruiters see only their own commissions; clients see hours and billing
  but never pay rates or margins.

### Resumes & signed URLs
- Uploads are content-checked (real PDF / macro-free DOCX, ≤ 4 MB), stored under random names in a private bucket.
- Downloads go through routes that re-check access and redirect to a **60-second** signed link, with
  `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. Employers can open only the one resume
  shared with an open submission; every view is audited.

### Server code
- Every server action checks the caller's role before doing anything (except public sign-in/sign-up and the
  contact form). Every database error shown to users is either a deliberate message or a generic one; raw SQL
  errors are logged, not displayed.
- Route handlers: resume downloads check the session and role; the cron endpoint requires `CRON_SECRET`.
- Redirects after sign-in go through `safeNextPath()` (same-site paths only).
- No secrets in browser bundles (scanned the production build for every secret name and key prefix).
- No `dangerouslySetInnerHTML` except JSON-LD built with `JSON.stringify`.
- `npm audit --omit=dev`: 0 vulnerabilities.

### Input validation & limits
- All forms validated server-side with Zod, then again by database constraints.
- Rate limits: contact/lead forms (hashed IP + email, plus a honeypot); Supabase Auth's built-in limits for
  sign-in, sign-up and password reset (surfaced as friendly messages); AI parsing (per person per hour, per
  organization per month, optional token budget).

### Audit logs
Role changes, company membership, job status, submissions, resume sharing and views, interview requests, all
finance and contract changes, timesheet approvals, payroll status, privacy requests and AI parsing are written to
`audit_log` (append-only for app users).

### Accessibility & mobile (public pages, production build, 375 px wide)
Home, Jobs, Employers, Candidates, Contact, Sign up, Sign in, Services, About, Privacy, Terms: no horizontal
scrolling, every image has alt text, every form field has a label, every button/link has an accessible name, one
`<h1>` per page, `lang="en"`, skip-to-content link. The CSP was verified in a browser: no violations, no blocked
assets.

## Remaining risks and checks to do

1. **Signed-in pages weren't browser-tested** (recruiter, candidate, employer, finance, contracts): there are no
   accounts in the live database yet. Once the Phase 9–13 SQL updates are run, sign in with each role and check
   each area on a phone and a desktop.
2. **End-to-end tests** (real browser, real Supabase) don't exist yet. Recommended before launch: Playwright smoke
   tests for sign-up → apply → recruiter moves stage → submit to employer → employer reviews.
3. **CSP allows inline scripts** (`'unsafe-inline'`), which Next.js needs unless every page uses per-request nonces.
   All user content is rendered as text, which is the main XSS protection.
4. **Supabase project settings** must match production: email confirmation on, password policy (10+ chars, mixed
   case and digits), Site URL and redirect URLs set to the real domain, leaked-password protection on, MFA for
   admins recommended.
5. **Legal**: privacy notice and terms still show the draft banner (`LEGAL_REVIEWED`); AI parsing needs the privacy
   review in the README before it's switched on; contract staffing must not be used for real payroll.
6. **Backups/monitoring/incident response** are Phase 14.
7. **Seed/demo data** must not be loaded into production.
