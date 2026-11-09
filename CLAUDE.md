# CoreTech Recruiting — Claude Code Project Instructions

## Project mission
Build a modern, secure recruiting operations platform for a Texas-based IT and telecommunications recruiting consultancy.

## Brand
- CoreTech Recruiting
- Tagline: Connecting Technical Talent. Powering Business.
- Palette (violet + teal, adopted 2026-10-30; replaced the original navy/electric blue):
  - Violet (primary) `#6D28D9` — Tailwind `brand` (`brand-700` `#5B21B6`, `brand-400` `#A78BFA`, `brand-50/100`)
  - Teal (accent) `#0D9488` — Tailwind `teal`; use `teal-text` `#0F766E` for small text on white
  - Ink (text) `#111827` — `ink`; Night (dark sections) `#130B2B` — `night`; Surface `#F8F7FC` — `surface`
  - Signature gradient: violet → teal (`from-brand to-teal`, `text-gradient` utility)
- Style: light-first, gradient-mesh heroes, rounded (2xl–[2rem]) photo cards, pill buttons, subtle motion that respects reduced-motion.
- Photography: Unsplash-licensed stock in `src/content/photos.ts`. Never present stock people as CoreTech staff, clients, candidates or testimonials.

## Stack
- Next.js App Router
- TypeScript strict mode
- Tailwind CSS
- shadcn/ui
- Supabase PostgreSQL, Auth, Storage
- Vercel
- GitHub
- Optional server-side OpenAI API and Resend

## Business workflows
- Direct-hire recruitment is the first operational priority.
- Contract staffing must be modeled, but must not be represented as ready for live payroll until employment/payroll, insurance, legal, and funding arrangements are verified.
- AI is assistive only; a human makes all employment decisions.

## Engineering rules
- Inspect before modifying.
- Implement one milestone at a time.
- Keep components reusable and typed.
- Validate all inputs server-side.
- Use server-side authorization and Supabase RLS.
- Never expose service-role keys or API secrets in client code.
- Store resumes in private storage and use authorized short-lived signed URLs.
- Never expose internal recruiter notes to candidates or employers.
- Employer users must only access their own company data and explicit candidate submissions.
- Users cannot grant themselves roles.
- Add tests for access control and data isolation.
- No fake success states or nonfunctional buttons.
- Label all demo data.
- Run lint, typecheck, tests, and production build.
- Update README and this file as architecture evolves.

## AI safeguards
- Do not automatically reject candidates or make hiring decisions.
- Do not use protected characteristics, sensitive traits, or proxies.
- Provide job-related evidence for matching suggestions.
- Require human review before saving parsed candidate data or sending communications.
- Review privacy and vendor data handling before sending real candidate data to AI services.

## Current architecture (update each phase)
- Phases 1–11 complete (foundation; database, auth, RLS; public website; recruiter ATS; jobs & applications; pipeline; employer portal; candidate portal; interviews & notifications; direct-hire finance; contract staffing; AI resume parsing & matching; security & QA audit — see `docs/SECURITY_AUDIT.md`; deployment preparation — `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/ADMIN_GUIDE.md`). All 14 planned phases are built; the site has not been deployed yet (needs the operator's GitHub/Vercel/domain/Resend accounts and explicit approval). Job Radar is an extra module. Phases are listed in `docs/DEVELOPMENT_PROMPTS.md`.
- Recruiter workspace lives under `/recruiter` (layout + each page call `requireRole(STAFF_ROLES)`; actions use `getStaffUser()`). Candidate sub-resource actions go through `candidateContext()` in `src/app/recruiter/candidates/[id]/actions.ts`.
- Candidate activity is trigger-written (`private.log_candidate_activity`) and append-only — never insert it from app code. Add new candidate child tables to that trigger.
- Resumes: validate bytes with `checkResumeFile()`, store at `{org}/{candidate}/{uuid}.{ext}` in the private `resumes` bucket, download only via the signed-URL route (60 s). Never expose storage paths or create public URLs.
- The proxy sets `x-coretech-pathname` (always overwritten) so layouts can build `?next=` links.
- `supabase/seed.sql` is demo-only data; every row must be `is_demo = true` and labeled "(Demo)" (a test enforces this).
- Public site: content pages under `src/app/*`, specialty pages generated from `src/content/specialties.ts`. Add every new public route to `PUBLIC_PATHS` in `src/lib/seo-routes.ts` (a test enforces that nav links point only there) and use `pageMetadata()` for metadata.
- Leads: `public.leads` has no client insert/read path. Only `src/lib/leads/actions.ts` inserts, via `createAdminClient()` (secret key, `server-only`, bypasses RLS — use it only after validation, never with unchecked user filters). Staff triage at `/admin/leads`.
- Public jobs: only via `get_published_jobs()` / `get_published_job()` (approved fields). `jobs.description` is internal; `public_description` is candidate-facing. Render job text as plain text.
- Forms that depend on configuration render a "not available" notice instead of a non-working form (`LeadFormSection`, `AuthNotConfigured`).
- Pipeline: never update `applications.stage` directly (privilege revoked). Use `move_application_stage()` / `submit_application_to_client()` (consent required) / `withdraw_my_application()`; they write `application_stage_events`. Keep `src/lib/pipeline/stages.ts` in sync with the `application_stage` enum and `private.stage_requires_reason()`. Candidates see only `my_applications()` (simplified status).
- Job Radar (`src/lib/market/`): external job data is untrusted — parsers must sanitize (plain text, https-only URLs, length caps) and never throw on bad records. Postings/matches/runs/deliveries are written only by the scan via the service role (`repo.ts`); staff may change only match `status`/`pursued_job_id`. Never scrape sites against their terms; add sources as connectors in `sources.ts` with fixture tests. Escape all job data per channel (HTML email, Slack mrkdwn). Log every notification attempt; "sent" = provider accepted.
- PWA: `src/app/manifest.ts`, `public/sw.js`, `public/icons/`. The service worker must never cache navigations/HTML or anything user-specific — only `/_next/static/*`, icons and the cookie-less `/offline` page (`tests/pwa.test.ts` enforces this). Android Play Store app = Trusted Web Activity via `/.well-known/assetlinks.json`.
- Candidate portal (`/candidate`, layout + pages call `requireRole(["candidate"])`): candidates never get a direct UPDATE on `candidates` — profile edits go through `update_my_candidate_profile()` (approved fields only), preferences through `set_my_preferences()`, privacy requests through `submit_privacy_request()` / admin-only `resolve_privacy_request()` (`/admin/privacy`). `private.ensure_my_candidate()` creates the record on first use. Candidates may upload/list/download resumes on their own record (max 5 of their own) and delete only ones they uploaded; storage policies use `private.is_own_resume_path()` / `can_remove_own_resume_object()`. Read only approved columns (`src/lib/candidates/portal-queries.ts`). Interviews appear in Phase 9.
- Employer portal (`/employer`, `/employer/[companyId]/…`; layout calls `requireRole(["employer"])` and 404s non-members via `getMyCompany()`): employers have no direct writes. Company profile (`update_my_company`, owners only; name stays staff-managed), team (`company_team()` lists only members who still hold the employer role; owners use `set_company_member_role_as_owner` / `remove_company_member_as_owner`, always keeping one owner; new teammates go through `request_company_member` → staff), job requests (`submit_job_request` / `cancel_job_request`; staff `review_job_request` / `convert_job_request` creates a draft job), submissions (`respond_to_submission`: under review / declined only; `add_submission_feedback` — never visible to candidates), interview requests (`request_interview` with up to 3 future times; staff `handle_interview_request`). Resumes reach employers only via `share_resume_with_submission` (staff) + `get_shared_resume` (audited, open submissions only) + the storage policy `private.can_employer_read_resume_object()`. Staff manage all of this at `/recruiter/companies`. Tests: `tests/db/employer-portal.test.ts` (two-company isolation).
- Interviews (`/recruiter/interviews`, schedule from a candidate's application or an employer request): `interviews` rows are written only by `schedule_interview` / `reschedule_interview` / `cancel_scheduled_interview` / `record_interview_outcome`, each logged in append-only `interview_events`. Client/final interviews link to the open submission and are visible to that employer via `company_interviews()`; candidates read `my_interviews()`. Neither sees `outcome`, `outcome_summary` or feedback (`interview_feedback`: staff, plus employers on client interviews via `add_interview_feedback`). Outcomes never move the pipeline or contact anyone.
- Transactional email (`src/lib/interviews/email.ts` templates + `.ics`, `notify-server.ts` sender): uses Resend via `RESEND_API_KEY` + `MARKET_ALERTS_FROM`; sent only when the recruiter ticks "Email the candidate", skipped when the candidate turned off application emails or email isn't configured. Every attempt (sent/failed/skipped) is logged with `log_interview_email()` into `notification_deliveries`; "sent" = provider accepted. Never claim delivery.
- Direct-hire finance (`/recruiter/finance`, admin only; `/recruiter/commissions` for all staff): `placements` (one per application at Offer/Placed; `fee_amount` and `guarantee_ends_on` are generated columns), `invoices` (invoice or credit note, `INV-`/`CN-` numbers, draft → sent → partially_paid/paid via `private.refresh_invoice_status`, or void), `payments` (on a credit note = refund paid out), `commissions` (split × rate on the fee net of refunds; status derived in `commission_overview()`). All writes are admin-only SECURITY DEFINER functions that audit. Keep the four buckets separate everywhere — forecast / earned / invoiced / collected — as defined in `finance_summary()` and `BUCKETS` in `src/lib/finance/validation.ts`. Recruiters see only placements they're credited on and their own commissions; employers and candidates see nothing. The app never sends invoices; admins send them and mark them sent.
- Contract staffing (`/recruiter/contracts`, admin only; clients approve at `/employer/[companyId]/timesheets`): `contract_assignments` (worker = candidate, client = company, bill/pay rates, OT multipliers, ESTIMATED burden %, client terms, pay frequency, employment model) and weekly `timesheets` that snapshot rates when entered; `billing` / `gross_pay` are generated columns; spread, est. burden and net margin are computed in `contract_overview()`, which also reports cash exposure (worker cost on approved weeks not yet paid for by the client). Writes via admin-only functions (`save_assignment`, `save_timesheet`, `set_payroll_status`, `create_contract_invoice`); `review_timesheet` lets the client's employer users approve/reject (admins may record an off-portal approval with a note). Employers see only `company_timesheets()` — hours and billing, never pay rate, burden or margin. Contract invoices are rows in `invoices` with `assignment_id`; voiding one releases its timesheets. **Never present this as live payroll**: payroll status only records what an external provider did, and every contract page shows `NOT_PAYROLL_NOTICE`. Warnings (margin, cash-flow gap, 1099 classification, exposure) live in `src/lib/contracts/validation.ts`.
- AI (`src/lib/ai/`): OpenAI via `fetch` (no SDK), structured outputs with `PROPOSAL_JSON_SCHEMA`, `store: false`. Off unless `AI_PRIVACY_REVIEW_APPROVED=true` + `OPENAI_API_KEY` + `OPENAI_MODEL` (`getAiConfig()`); never assume a model name. Flow: `loadResumeText` (unpdf / mammoth) → `redactContactDetails` → `begin_resume_parse()` (checks hourly/monthly/token limits BEFORE the call and logs it) → `proposeWithOpenAI` (never throws) → `checkProposal` (zod + verifies each evidence quote is in the sent text) → `finish_resume_parse()`. Proposals are never applied automatically: `/recruiter/candidates/[id]/ai/[parseId]` → recruiter ticks items → normal inserts under RLS → `review_resume_parse()`. Never add fields for protected characteristics or proxies (no education/graduation dates), never score/rank/recommend, never auto-reject. Job matching (`src/lib/matching/match.ts`) is deterministic evidence lookup, no scores.
- Security invariants (`tests/db/security-invariants.test.ts`) check the whole schema: RLS on every table, no anon grants, anon may call only the public job functions, every SECURITY DEFINER function pins search_path, direct write grants match a reviewed list, every insert/update policy has WITH CHECK. A new table or direct grant must be added deliberately there. Candidates never read raw `candidates`/`applications` rows — use `my_candidate_profile()` / `my_applications()`; `submissions` have no direct write path at all. Headers (CSP, HSTS when the site URL is https) live in `next.config.ts`; any new external origin (scripts, images, APIs called from the browser) must be added to the CSP.
- Production: `/api/health` (public, no data — app up + database reachable, 200/503) for uptime monitors; `npm run preflight` checks an env file for launch readiness without printing values (`scripts/preflight-checks.mjs`, tested in `src/lib/preflight.test.ts`) — add a check there when adding a required setting. Never deploy, change production data or push code without the operator's explicit go-ahead.
- `supabase/manual/all-migrations.sql` is a generated single-file copy of every migration (plus a one-off backfill for accounts created before the tables) for pasting into the Supabase SQL editor on a new project; regenerate it when migrations change. The live project gets each later migration as `supabase/manual/update-phase-N-*.sql` (a copy of that migration) — the live DB had everything through Phase 8 on 2026-11-04.
- Legal pages show a draft banner until `LEGAL_REVIEWED` is set to true after legal review.
- Database: `supabase/migrations/`. Every table has RLS; each migration revokes Supabase's default anon/authenticated grants and re-grants only what policies cover. Authorization helpers are `private.*` SECURITY DEFINER functions (`is_staff`, `is_admin`, `is_company_member`, `is_own_candidate`) with `search_path = ''`.
- Roles: `app_role` enum (admin, recruiter, employer, candidate) in `user_roles`. The only write paths are `public.assign_role` / `revoke_role` (admin-only, never self) and the signup trigger (always `candidate`; skipped when `app_metadata.invited = true`). Never read roles from JWT or user metadata.
- Employers reach candidate information only through `submissions` (curated snapshot + consent). Candidate notes have no non-staff policy at all. Public jobs only via `get_published_jobs()`.
- New tables must: enable RLS, revoke default grants, add policies, and get tests in `tests/db/access-control.test.ts` (PGlite + `tests/db/supabase-stub.sql`).
- App auth: `src/lib/auth/session.ts` (`getSessionUser`, `requireUser`, `requireRole`), Zod schemas in `src/lib/validation/`, server actions return `FormState` (`src/lib/forms.ts`). Auth UI shows a "not configured" notice when Supabase env is missing.
- Next.js 16: request interception lives in `src/proxy.ts` (not `middleware.ts`). It only refreshes the Supabase session — never rely on it for authorization.
- Supabase clients: `src/lib/supabase/client.ts` (browser), `server.ts` (`server-only`, per-request), `proxy.ts` (session refresh). All use the publishable key; a secret-key admin client does not exist yet and must be `server-only` when added.
- Env: `src/lib/env.ts` validates public vars with Zod. Supabase is optional (both vars empty = off); partial config throws.
- Brand tokens are defined in `src/app/globals.css` (`navy`, `electric`, `cyan`, `cloud`, `success`) and mapped onto shadcn semantic tokens.
- Navigation (`src/config/site.ts`) lists only routes that exist.
- Checks: `npm run check` runs lint, typecheck, Vitest and build.

## Definition of done
A feature is not complete until its UI, server logic, authorization, validation, error states, tests, and documentation are implemented and verified.
