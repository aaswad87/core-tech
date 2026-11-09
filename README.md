# CoreTech Recruiting

Recruiting operations platform and public website for CoreTech Recruiting, a Texas-based IT and
telecommunications recruiting consultancy. *Connecting Technical Talent. Powering Business.*

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation, brand, layout, Supabase client setup | Done |
| 2 | Database, auth, roles, RLS | Done |
| 3 | Public website, lead forms, job board, SEO | Done |
| 4 | Recruiter ATS and candidate CRM, private resume storage | Done |
| 5 | Job management and candidate applications | Done |
| 6 | Recruiting pipeline (board + table, 12 stages, history) | Done |
| 7 | Employer portal | Done |
| 8 | Candidate portal | Done |
| 9 | Interviews and email notifications | Done — email needs Resend |
| 10 | Direct-hire finance | Done |
| 11 | Contract staffing (tracking only — not payroll) | Done |
| 12 | AI resume parsing and job-match evidence | Done — AI off until the privacy review |
| 13 | Security and QA audit | Done — [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) |
| 14 | Deployment preparation | Done — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md); not yet deployed |

Database rules for every phase are covered by automated tests. Signed-in screens have not yet been exercised
end to end against the live Supabase project — see the audit's *Remaining risks*. Phase prompts are in
[docs/DEVELOPMENT_PROMPTS.md](docs/DEVELOPMENT_PROMPTS.md).

Without Supabase configured the marketing pages work fully; auth pages, lead forms and the job board show
an honest "not available" notice instead of a form or listing that cannot work.

### Content to confirm before launch

- **Privacy Policy and Terms of Use** (`/privacy`, `/terms`) are drafts written to match what the code
  actually does. They show a "pending legal review" banner until `LEGAL_REVIEWED` in
  `src/components/marketing/legal-page.tsx` is set to `true` after counsel reviews them.
- **Business commitments stated in copy** — confirm these are true for CoreTech: no fees to candidates;
  candidates learn the employer's name before interviewing; scope and terms agreed in writing before a
  search; direct hire is the current focus (contract staffing is intentionally not offered on the site).
- No phone number, email address, street address, team names, client logos, statistics or testimonials
  are on the site. Add real ones only.

## Stack

- Next.js 16 (App Router, `src/proxy.ts` replaces middleware) · React 19 · TypeScript strict
- Tailwind CSS v4 · shadcn/ui (Radix, `radix-nova` style) · lucide-react icons
- Supabase (`@supabase/ssr`) for Postgres, Auth and Storage
- Zod for validation · Vitest for tests
- Deployment target: Vercel

## Getting started

Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env.local   # optional — the site runs without Supabase
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | public | Canonical site URL for metadata |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Supabase publishable (or legacy anon) key |
| `SUPABASE_SECRET_KEY` | **server only** | Secret / service-role key. Stores website leads; keys the IP hash |

If both public Supabase variables are empty, Supabase is treated as not configured and the session proxy
is skipped. If only one is set, or a value is malformed, the app throws at startup rather than silently
running without auth. `SUPABASE_SECRET_KEY` is read only in `server-only` modules
(`src/lib/env.server.ts`, `src/lib/supabase/admin.ts`). Never give a secret the `NEXT_PUBLIC_` prefix.

## Supabase setup

For local development with Docker, `npx supabase start` then `npx supabase db reset` applies the
migrations and loads `supabase/seed.sql` (demo data only).

1. Create a Supabase project and put its URL and publishable key in `.env.local`.
2. Apply the migrations in `supabase/migrations/`:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Auth → URL Configuration:** set Site URL to your `NEXT_PUBLIC_SITE_URL` and add
   `<site-url>/auth/confirm` to the redirect allow list.
4. **Auth → Providers → Email:** keep "Confirm email" on. **Auth → Policies:** minimum password length 10,
   with lowercase, uppercase and digits (matches `supabase/config.toml` and the app's validation).
5. **Auth → Email Templates** (recommended, so links work even if opened in a different browser):
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/account`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

   The default `{{ .ConfirmationURL }}` templates also work, but only in the browser that started the flow.
6. **Create the first administrator.** Sign up through `/signup`, confirm the email, then run this once in
   the Supabase SQL editor (it runs as the database owner, which is the only way to grant a role
   without an existing admin):
   ```sql
   insert into public.user_roles (user_id, organization_id, role)
   select id, organization_id, 'admin' from public.profiles where email = 'you@example.com';
   ```
   After that, admins assign every other role at `/admin/users`.

## Access model

| Role | How it is granted | Can see |
| --- | --- | --- |
| Administrator | SQL bootstrap (first admin), then by another admin | Everything in the organization, users and roles, audit log |
| Recruiter | Admin at `/admin/users` | All companies, jobs, candidates, internal notes, applications, submissions |
| Employer | Admin assigns the role; staff add them to a company | Their own companies, those companies' jobs, job and interview requests, and submissions made to them (`/employer`) |
| Candidate | Automatically on self sign-up | Their own profile, resumes, preferences, privacy requests, applications and submissions (`/candidate`) |
| Anonymous | — | Published jobs only, via `get_published_jobs()` with approved public fields |

- Roles live in `user_roles` and change only through the `assign_role` / `revoke_role` database functions,
  which require an admin and refuse changes to your own roles. Changes are written to `audit_log`.
- Roles are never read from the JWT or from user-editable signup metadata.
- Employers never read the `candidates` table or recruiter notes. A `submission` holds a
  recruiter-curated snapshot (display name, shared summary) and requires recorded candidate consent.
- Employer access ends as soon as the employer role is revoked, even if a company membership row remains.
- Users created by an admin through the service-role API with `app_metadata.invited = true` get no
  default role. Invitation UI is not built yet.
- `leads` (website inquiries) has **no** client insert or read path. The server inserts validated leads
  with the secret key; staff read them and may change only `status` (audited) at `/admin/leads`.

## Public website

| Route | Notes |
| --- | --- |
| `/`, `/about`, `/services`, `/employers`, `/candidates`, `/contact`, `/privacy`, `/terms` | Static content |
| `/services/[slug]` | IT Recruiting, Networking, Cybersecurity, Cloud, Telecommunications — from `src/content/specialties.ts` |
| `/jobs` | Search, work-arrangement filter, pagination. Filtered pages are `noindex` |
| `/jobs/[id]` | Public fields only, plus a "send to a recruiter" form tied to the job |
| `/admin/leads` | Staff inbox for website inquiries |

## AI resume parsing and job matching

**Job match evidence** (no AI, always on): on a candidate's Applications list, *Compare to job* shows, for
each of the job's required and preferred skills, where it appears in the candidate's skills, certifications,
work history, profile and latest resume — with the quote — or that no evidence was found. It's evidence to
read, not a score, ranking or recommendation; "no evidence" means it isn't written down.

**AI resume parsing** (off by default): on a candidate's resume, *Suggest profile details* reads the resume
and proposes a headline, summary, location, skills, certifications and work history. Every item shows a
verbatim quote from the resume and a confidence level; the server checks each quote really appears in the
resume. **Nothing is saved until a recruiter ticks the items to keep** (unverified and low-confidence items
start unticked) — or discards them all.

Safeguards:
- Contact details (emails, phones, links, street addresses) are removed before the text is sent.
- The AI is asked only for job-related facts; the response format has no fields for age, dates of birth,
  graduation years, gender, race, religion, nationality, marital status, disability or photos. It never judges,
  ranks or recommends candidates, and nothing rejects anyone automatically.
- Requests ask the provider not to store them (`store: false`).
- Limits are checked before each call: per person per hour (`AI_HOURLY_LIMIT`), per organization per month
  (`AI_MONTHLY_PARSE_LIMIT`) and an optional monthly token budget (`AI_MONTHLY_TOKEN_BUDGET`). Failed calls
  count too. Every request — who, which resume, model, tokens, outcome — is logged and audited; the proposal is
  kept for review history (staff only).
- Failures (timeouts, provider errors, scanned resumes without text, malformed responses) are shown plainly and
  change nothing.

**Turning it on — privacy & security review first.** Before setting `AI_PRIVACY_REVIEW_APPROVED=true`:
1. Sign the AI provider's data processing agreement and confirm their data retention / training settings for
   API data (ask for zero data retention if available).
2. Update the privacy notice to say resumes may be processed by an AI service to suggest profile details, and
   name the provider.
3. Decide who may use it (all recruiters, or admins only) and train them: suggestions must be checked against
   the quotes, and AI output is never a hiring decision.
4. Set a monthly token budget that matches your spending limit, and set the same limit in the provider's dashboard.
5. Then set `OPENAI_API_KEY`, `OPENAI_MODEL` (a model that supports structured outputs) and
   `AI_PRIVACY_REVIEW_APPROVED=true`, and restart the app.

## Contract staffing (`/recruiter/contracts`, administrators)

> **Tracking only — not a payroll system.** The app never pays workers, withholds taxes or files anything.
> Before placing real contractors, confirm a payroll provider or employer of record, workers' comp and
> liability insurance, worker classification with an employment attorney, and funding to cover pay before
> clients pay.

- **Assignments**: worker (a candidate), client (a company), dates, bill and pay rates per hour, overtime
  multipliers, an *estimated* employer burden %, the client's payment terms and how often the worker is paid,
  and the engagement model (W-2 via a payroll provider, corp-to-corp, 1099). The form shows spread, burden and
  net margin per hour as you type, plus warnings for losing or thin margins, the cash-flow gap and 1099 risk.
- **Timesheets**: enter each week's regular and overtime hours and send it for approval. The client approves or
  sends it back in the employer portal (**Timesheets** tab), or you record an approval they gave by email (a note
  is required). Rates are copied onto each week, so later rate changes don't rewrite history.
- **Separate figures**: billing (client owes), worker gross pay, gross spread, estimated burden and net margin —
  per week, per assignment and in total — plus **cash exposure**: worker cost on approved weeks the client hasn't
  paid for yet.
- **Invoices**: pick approved weeks and create a draft invoice; it then works like any other invoice in Finance
  (send, record payments). Voiding it frees the weeks to be invoiced again.
- **Payroll status**: per approved week — ready, sent to provider, paid by provider (with the provider's
  reference). This records what your provider did; it doesn't pay anyone.
- Clients see hours and billing only — never pay rates, burden or margin. Recruiters see none of this.

## Direct-hire finance (`/recruiter/finance`, administrators)

- **Placements**: when a candidate reaches Offer or Placed, record the placement (offer accepted date, start
  date, base salary, fee as a % of salary or a flat amount, guarantee period). The fee and guarantee end date
  are calculated. Move it to *Started* on the start date, *Cancelled* if the offer falls through, or *Fell off*
  if the candidate leaves — with a free replacement, full / partial refund, or nothing owed.
- **Invoices**: create a draft from the placement (prefilled with the fee), print or save it as PDF from the
  browser, send it to the client yourself, then *Mark as sent*. Record each payment as it arrives; the invoice
  becomes partially paid / paid automatically. Refunds are a **credit note** against the original invoice, with
  the refund recorded as a payment on the credit note. Invoices with payments can't be voided.
- **Commissions**: each placement can credit one or more recruiters (split %) at a commission rate. The amount
  uses the fee net of refunds. Status: forecast → earned (started) → payable (client paid in full) → paid
  (payout recorded), or clawed back / cancelled. Recruiters see their own at **Commissions**.
- **The four numbers on the Finance page are never mixed**:
  - *Forecast* — fees on accepted offers starting in the period (not money yet)
  - *Earned* — fees on placements that started in the period, minus refunds owed
  - *Invoiced* — invoices sent in the period, minus credit notes
  - *Collected* — payments received in the period, minus refunds paid out

  Also shown: outstanding balance, fees still inside a guarantee period, and refunds owed but not yet paid.
- Every finance change is written to the audit log. Recruiters can't see invoices, payments or other people's
  commissions; employers and candidates can't see any finance data.

## Interviews (`/recruiter/interviews`)

- **Schedule** from a candidate's Applications list (*Schedule interview*) or from an employer's interview
  request (the employer's proposed times are offered as one-click picks). Each interview has a type
  (recruiter screen, technical, client, final, other), format (video link / phone / on-site address), start
  time in its own time zone, length, interviewers and candidate-facing instructions.
- **Reschedule** (reason required) or **cancel** (reason required). Every change is kept in the interview's history.
- **Outcome**: after the start time, record completed / no-show and the recruiter's assessment. This is a
  record only — it never moves the pipeline, rejects anyone or emails anyone.
- **Feedback**: recruiters add internal feedback; for client interviews the employer's team can add
  feedback from their portal. Candidates never see feedback or outcomes.
- **Who sees what**: candidates see their interviews on their portal overview; employers see client
  interviews for candidates submitted to them.

### Interview emails

When the recruiter ticks *Email the candidate*, the candidate gets a confirmation / change / cancellation
email with a calendar invite (`.ics`). Emails need `RESEND_API_KEY` and `MARKET_ALERTS_FROM` (a From
address on a domain verified in Resend). If email isn't configured, or the candidate turned off application
emails in their preferences, nothing is sent and the page says so. Every attempt is listed in the
interview's **Email log** as *sent* (accepted by Resend — not proof of inbox delivery), *failed* or *skipped*.
The interview page also shows the exact text the candidate receives.

## Employer portal (`/employer`)

Client hiring managers sign in and work only with their own company:

- **Jobs & candidates** (`/employer/[companyId]`): the company's jobs, and the candidates CoreTech has
  submitted (each with recorded candidate consent). The employer sees only the recruiter-written snapshot,
  plus a resume if the recruiter chose to share one. Resume downloads use a 60-second signed link, are
  audited, and stop working once the submission closes.
- **Candidate page**: mark under review or not moving forward, request an interview (format, length, time
  zone, up to 3 proposed times), and leave feedback for CoreTech. Candidates never see that feedback.
- **Job requests** (`/employer/[companyId]/requests`): ask CoreTech to open a role; see the status and replies.
- **Company & team** (`/employer/[companyId]/company`): owners edit the company profile (not the name),
  change teammates' roles, remove teammates, and ask CoreTech to add new ones. A company always keeps an owner.

**Giving a client access:** the person signs up at `/signup`, an administrator gives them the **Employer**
role at `/admin/users`, then a recruiter adds them at **Recruiter → Companies → (company) → Employer portal
access**. Staff handle job requests, interview requests, teammate requests and resume sharing on that page.

## Candidate portal (`/candidate`)

Signed-in candidates (the role every self sign-up gets) can:

- **Profile & resume** (`/candidate/profile`): edit name, phone, location, headline and summary, and upload
  up to 5 resumes (PDF or .docx, 4 MB, content-checked on the server). Files go to the private `resumes`
  bucket and download through a 60-second signed link. Candidates can remove resumes they uploaded, but
  not one a recruiter added.
- **Overview** (`/candidate`): their applications with a simplified status, withdraw, and a profile checklist.
- **Preferences** (`/candidate/preferences`): roles, locations, work arrangement, relocation, and which
  emails/calls they agree to. Recruiters see these on the candidate's record.
- **Privacy** (`/candidate/privacy`): request a copy, correction or deletion of their data, or no further
  contact. Administrators work through them at `/admin/privacy`; the candidate sees the status and reply.

Candidates never update the `candidates` table directly: every change goes through a database function that
writes only approved fields, so tags, owner, source and recruiter notes stay recruiter-only. Interview
details arrive with Phase 9.

## Recruiter workspace (`/recruiter`)

Staff-only (admins and recruiters). The layout, every page, every server action, and RLS each check access.

| Route | What it does |
| --- | --- |
| `/recruiter/candidates` | Search (name, email, headline, location, skill), filter by owner / exact skill / tag, 25 per page |
| `/recruiter/candidates/new` | Create; warns about possible duplicates before saving |
| `/recruiter/candidates/[id]` | Profile, work history, skills, certifications, resumes, internal notes, activity history |
| `/recruiter/candidates/[id]/edit` | Edit contact/profile fields, tags and owner; duplicate warning |
| `/recruiter/candidates/[id]/resumes/[resumeId]` | Redirects staff to a 60-second signed download URL |

- **Ownership:** new candidates default to the creator. Only the current owner or an admin can reassign
  (database trigger), and owners must be staff. Reassignments are logged.
- **Duplicates:** `find_candidate_duplicates()` matches normalized email, the last 10 phone digits, or full
  name. Saving requires ticking "this is a different person"; the profile page shows a banner too.
- **Activity history:** written only by database triggers (create, field-level updates, owner changes,
  skills, certifications, work history, notes, resumes). No one can insert, edit or delete it. Note
  bodies are never copied into it. Candidate deletion (admin only) is recorded in `audit_log`.
- **Internal notes:** staff only; delete your own (admins any). There is no candidate or employer policy.
- **Resumes:** PDF or .docx, max 4 MB. The server checks the actual bytes (PDF header; DOCX ZIP structure;
  macro documents rejected), not the browser's MIME type. Files go to the private `resumes` bucket at
  `{org_id}/{candidate_id}/{random}.{ext}`, with no client-chosen path. Storage policies allow only staff of that
  organization to read, upload or delete; there is no overwrite. Identical files on one candidate are rejected
  by SHA-256. The 4 MB limit keeps uploads under Vercel's 4.5 MB request cap.

**Lead forms** (contact, hiring request, candidate interest) are one server action
(`src/lib/leads/actions.ts`): Zod validation, required privacy consent, a hidden honeypot field, rate
limits of 5 per IP per 15 minutes and 3 per email per hour (IPs are stored only as an HMAC), then an insert
with the service-role client. A success message appears only after the insert succeeds.

**Job board** data comes only from `get_published_jobs()` / `get_published_job()`, which return the
approved public fields (`title`, `public_summary`, `public_description`, `location`, `work_arrangement`,
`employment_type`, `published_at`). Internal `description`, salary, and client company are never exposed.
Job text is rendered as plain text, never HTML.

**SEO:** per-page titles, descriptions and canonical URLs (`src/lib/seo.ts`), Open Graph image, SVG
icon, breadcrumb and EmploymentAgency structured data, `sitemap.xml` (public pages + up to 1,000
published jobs, revalidated hourly) and `robots.txt` (private routes disallowed; Vercel preview
deployments fully disallowed). Set `NEXT_PUBLIC_SITE_URL` to the production domain for correct URLs.

## Testing

`npm run test` runs unit tests and the database access-control suite. `tests/db` loads every migration
into [PGlite](https://pglite.dev) (real Postgres compiled to WASM) together with a stub of Supabase's
`auth` schema, API roles and default grants, then runs queries as `anon` / `authenticated` users to prove:

- sign-up gives only the candidate role, and role claims in signup metadata are ignored
- nobody but an admin can grant or revoke roles, and admins cannot change their own
- Employer A cannot see Company B's company, jobs, or submissions, and no employer can read candidates,
  notes, or applications
- Candidate A cannot see Candidate B's data, and no candidate can see internal notes
- anonymous visitors cannot read any table directly
- leads cannot be read or written by anonymous users, candidates or employers; staff can change only status
- the public job functions return only published jobs and approved fields, and treat `%`/`_` in search literally
- skills, certifications, work history, resumes, notes and activity are staff-only — not visible to the
  candidate they describe, to employers, or to anonymous users
- resume storage objects are readable and writable only by staff under their own organization's prefix
- ownership rules, protected columns, activity logging, search filters and duplicate matching
- `supabase/seed.sql` applies cleanly and labels every record as demo data
- applying (role, published-only, no duplicates, first-time candidate record); stage moves with history,
  required reasons, consent-gated submission visible only to that employer, admin-only exit from Placed,
  no direct stage edits, and no stage reasons visible to candidates or employers

Weakening the storage read policy or the ownership guard makes these tests fail (checked by hand).

The stub covers what the migrations depend on, not all of Supabase, so also run the migrations against
a real project before production (`npx supabase db push`, or `npx supabase start` with Docker).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Development server |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | All Vitest tests (unit + database access control) |
| `npm run test:db` | Database access-control tests only |
| `npm run build` | Production build |
| `npm run check` | All of the above in order |

## Project structure

```
src/
  app/
    (auth)/            login, signup, forgot-password, reset-password + server actions
    auth/confirm/      Landing route for email links (token_hash and PKCE code)
    about/ services/ employers/ candidates/ contact/ privacy/ terms/   Public pages
    jobs/              Job board and job detail
    account/           Signed-in user's profile and roles
    admin/users/       Admin-only role assignment
    admin/leads/       Staff leads inbox
    recruiter/jobs/    Job list, create/edit, job page with pipeline and "add a candidate"
    recruiter/pipeline/ Cross-job pipeline (table/board) and stage-move actions
    recruiter/market/  Job Radar: matches inbox, match detail, hunts & sources
    api/cron/          Scheduled Job Radar scan (Bearer CRON_SECRET)
    recruiter/         Staff workspace: candidate list, create/edit, detail, resume download
    offline/           Offline fallback page (served by the service worker)
    .well-known/       assetlinks.json for the Android (TWA) app
    sitemap.ts robots.ts opengraph-image.tsx icon.svg manifest.ts
    access-denied/     Shown when a signed-in user lacks the required role
  components/
    auth/ forms/       Auth forms, field/message/submit-button primitives
    brand/ layout/     Logo, container, header, mobile nav, footer
    marketing/         Page hero, sections, CTA band, breadcrumbs, JSON-LD, legal page
    leads/ jobs/       Lead form, job metadata display
    candidates/        Candidate form, profile section forms, duplicate list
    ui/                shadcn/ui primitives (generated)
  config/site.ts       Site name, tagline, main and footer navigation
  content/             Specialty page content
  lib/
    auth/              roles.ts, redirect.ts (safe ?next=), session.ts (requireUser/requireRole)
    validation/        Zod schemas for every form
    leads/             Lead server action, rate limiting, labels
    jobs/              Public job board data access
    candidates/        Validation, resume file checks, queries, search params, formatting
    market/            Job Radar: sources, matching, scan pipeline, notifications, repo, queries
    jobs/ pipeline/    Job validation and staff queries; stage definitions shared with the DB rules
    seo.ts seo-routes.ts   Metadata helper; sitemap/robots builders
    env.ts             Validated public environment
    env.server.ts      Server-only secret key access
    supabase/          client.ts (browser), server.ts (per-request, RLS), public.ts (anon, no session),
                       admin.ts (server-only, secret key, bypasses RLS), proxy.ts (session refresh)
  proxy.ts             Next.js proxy — refreshes the Supabase session cookie
supabase/
  migrations/          Schema, RLS policies, role functions, storage bucket and policies
  seed.sql             Local demo data (all flagged is_demo and labeled "(Demo)")
  config.toml          Local Supabase CLI config (auth URLs, password policy)
tests/db/              PGlite harness and access-control tests
docs/                  Phase-by-phase development prompts
```

## Brand and design

| Token | Hex | Tailwind |
| --- | --- | --- |
| Violet (primary) | `#6D28D9` | `brand` (also `primary`) |
| Teal (accent) | `#0D9488` | `teal` (`teal-text` `#0F766E` for small text) |
| Ink | `#111827` | `ink` |
| Night | `#130B2B` | `night` |
| Surface | `#F8F7FC` | `surface` |

Tokens and animations (`animate-float`, `animate-marquee`, `animate-mesh`, the `.reveal` scroll effect and
the `text-gradient` utility) live in `src/app/globals.css`. All motion is decorative and disabled under
`prefers-reduced-motion`. Scroll-reveal uses CSS scroll-driven animations, so content stays visible in
browsers without support.

**Photography** comes from Unsplash under the [Unsplash License](https://unsplash.com/license) (free for
commercial use, no attribution required). Every photo, with its alt text and source page, is listed in
`src/content/photos.ts`. Images are served through `next/image` from `images.unsplash.com` (see
`images.remotePatterns` in `next.config.ts`). They are illustrative only: don't caption them as CoreTech
staff, clients or candidates. Swap in real team photos when available.

**Local dev note (this PC):** Norton Antivirus intercepts HTTPS, so Node needs the Windows certificate
store to fetch remote images. The preview config sets `NODE_OPTIONS=--use-system-ca`. In a plain terminal
run `$env:NODE_OPTIONS="--use-system-ca"; npm run dev` (PowerShell) if images fail with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Production (Vercel) is unaffected.

## Jobs and pipeline (`/recruiter/jobs`, `/recruiter/pipeline`)

**Jobs.** Staff create and edit jobs with a company (or a new one), owner, location, work arrangement,
employment type, salary range, required and preferred skills, a public summary/description and internal
notes. Statuses are draft, pending, published, paused, closed and archived. Only published jobs appear on the
public board, and publishing requires a public summary. `published_at` is set automatically, and every status
change is written to `audit_log`. Contract types can be recorded, but contract staffing isn't presented as
ready for live payroll.

**Applying.** Signed-in candidates get an **Apply** button on public job pages. `apply_to_job()` checks the
candidate role and that the job is published. It creates the candidate's record on first use and blocks a
second active application to the same job. Candidates see their applications on `/account` through
`my_applications()`: In progress, Hired, Closed or Withdrawn, never internal stage names or reasons. They can
withdraw an active application.

**Pipeline.** 12 stages: New, Screening, Recruiter Interview, Technical Evaluation, Submitted to Client,
Client Interview, Offer, On Hold, Placed/Hired, Rejected, Withdrawn, Future Opportunity. You can work from a
board (drag a card, or use its Move button) or a table, per job or across all jobs with job/stage/"my
candidates" filters.

- Stages change only through `move_application_stage()`. Direct updates to `applications` are revoked. Each
  move writes `application_stage_events` with the actor, the time, the stage before and after, and the
  reason. Events are staff-only.
- A reason is required for Rejected, Withdrawn, On Hold and Future Opportunity.
- **Submitted to Client** goes only through `submit_application_to_client()`. It requires a recorded
  candidate-consent confirmation and creates the `submission` with the display name and summary you choose.
  That's all the employer will ever see.
- Only an administrator can move a candidate out of Placed. Moves to or from Placed, Rejected and Offer are
  also written to `audit_log`.
- Placed, Rejected, Withdrawn and Future Opportunity close the application, so the candidate can be considered
  for the same job again later.

Job Radar's **Pursue** creates a draft job that opens straight into this pipeline. Each candidate's profile
shows their applications and has an "Add to a job's pipeline" picker.

## Job Radar (`/recruiter/market`)

Watches the job market for postings that fit what CoreTech recruits for, alerts the team, and turns a
posting into a pursued opportunity with suggested candidates from our database.

**Sources** (each turns on when its settings exist; see `.env.example`):

| Source | Covers | Setup |
| --- | --- | --- |
| JSearch (RapidAPI) | Google for Jobs data — **Indeed, Dice, LinkedIn and large employers' own career sites** (e.g. AT&T) | `JSEARCH_RAPIDAPI_KEY` |
| Adzuna | Adzuna's US job index | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` |
| Greenhouse / Lever | Specific companies' career pages hosted on those platforms | No key — add companies under Hunts & sources |

Indeed and Dice don't offer public search APIs, and scraping them breaks their terms, so they're covered
through JSearch. The JSearch parser is tolerant of field changes; check the first real scan's results after
adding the key. The Greenhouse and Lever parsers were checked against live feeds (1,597 real postings
parsed, none dropped).

**How it works.** A *hunt* lists keywords, excluded words, locations (state names match abbreviations, so
"Texas" matches "Dallas, TX"), whether remote counts, sources, and a minimum score. Each scan:

1. queries the sources, capped at 20 queries per aggregator and 60 career boards per run to bound API cost
2. stores sanitized postings: plain text only, `https` links only, length-capped
3. scores each posting: a keyword in the title is +3, in the description +1; excluded words and the location
   rule filter it out
4. records new matches, skipping the same job posted on several boards
5. emails each subscriber one digest through Resend, and posts to Slack if a webhook is set

Every delivery is logged in `notification_deliveries`. "Sent" means the provider accepted it.

**Pursue** saves the company (reusing an existing record) and an internal draft job, and marks the match
pursued. The match page suggests candidates from our database who mention the matched skills, with the
evidence shown. Nothing is sent to employers or candidates automatically; recruiters decide.

**Scheduling.** `vercel.json` calls `/api/cron/market-scan` once a day at 12:00 UTC (6–7 am Texas time),
because Vercel's Hobby plan only allows daily cron jobs. On Vercel Pro, change the schedule to
`0 */2 * * *` for a scan every 2 hours. The endpoint requires `Authorization: Bearer $CRON_SECRET`, which
Vercel sends automatically. Recruiters can also run a scan any time from Job Radar. For more frequent scans on Hobby, use Supabase `pg_cron` + `pg_net`, or a GitHub
Actions schedule, calling the same URL with the header. Scans less than 5 minutes apart are skipped. Staff
can also click "Run scan now".

**Turning on email:** create a Resend account, verify your sending domain (DNS records), and set
`RESEND_API_KEY` and `MARKET_ALERTS_FROM`. **Slack later:** create a Slack app with an Incoming Webhook for
your team channel and set `SLACK_MARKET_WEBHOOK_URL`.

## Installable app (PWA) and Android

The site is a Progressive Web App: on Android (Chrome/Edge) and desktop it can be installed to the home
screen and opens full-screen with the CoreTech icon. An "Install the app" button appears in the footer only
when the browser actually offers installation.

| Piece | Where |
| --- | --- |
| Manifest (name, colors, icons, shortcuts to Jobs / Hire / Contact) | `src/app/manifest.ts` → `/manifest.webmanifest` |
| Icons (any + maskable, 192/512, Apple 180) | `public/icons/`, regenerate with `node scripts/generate-icons.mjs` |
| Service worker | `public/sw.js`, registered in production only |
| Offline page | `/offline` |
| Android app ↔ site link | `/.well-known/assetlinks.json` (from `ANDROID_TWA_*` env vars; `[]` until set) |

**Service worker privacy rules** (tested in `tests/pwa.test.ts`): pages are never cached because they can
contain private recruiting data. Only hashed build assets and icons are cached. `/offline` is cached at install
without cookies. Form posts, server actions, uploads and cross-origin requests are never intercepted. Bump
`VERSION` in `sw.js` to drop old caches after changing these rules.

### Publishing to Google Play (Trusted Web Activity)

Requires the site live on its real HTTPS domain first.

1. Check the live site in Chrome DevTools → Application → Manifest (no installability errors), or at
   [pwabuilder.com](https://www.pwabuilder.com).
2. Generate the Android project: PWABuilder → "Package for stores" → Android, or
   `npx @bubblewrap/cli init --manifest https://<your-domain>/manifest.webmanifest`. Choose a package name
   such as `com.coretechrecruiting.app`.
3. Create a Google Play developer account (one-time fee) and an app in Play Console. Use Play App Signing.
4. Copy the app-signing SHA-256 fingerprint from Play Console → App integrity, and set
   `ANDROID_TWA_PACKAGE_NAME` and `ANDROID_TWA_SHA256_FINGERPRINTS` in Vercel. Redeploy, then confirm
   `https://<your-domain>/.well-known/assetlinks.json` shows them. Without this the app shows a browser bar.
5. Upload the generated `.aab`, complete the store listing (screenshots, privacy policy URL `/privacy`, data
   safety form), and submit for review.

A native app (React Native/Expo on the same Supabase backend) is the next step once the candidate portal
(Phase 8) exists.

## Security notes

The Phase 13 audit — what was checked, what was fixed, and the remaining risks to close before launch — is in
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md). `tests/db/security-invariants.test.ts` re-checks the
database-wide rules on every test run.

- User-facing Supabase clients use only the publishable key; authorization is enforced by RLS plus
  server-side `requireUser` / `requireRole` checks. The secret-key client (`admin.ts`) is `server-only` and
  used solely to insert validated leads.
- The proxy only refreshes sessions. It is not an authorization layer.
- Sign-in, sign-up and reset messages don't reveal whether an account exists. `?next=` redirects accept
  only same-origin paths. Rate limiting comes from Supabase Auth's built-in limits.
- No database types are generated yet (there is no linked project). After linking, run
  `npx supabase gen types typescript --linked > src/lib/database.types.ts` and pass it to the clients.
- Baseline security headers are set in `next.config.ts`.
- When Supabase is configured, the header checks the session on every request, so all pages render
  dynamically. That's expected for now; revisit with Partial Prerendering if marketing-page latency matters.
- `npm audit` reports 3 low-severity advisories in the `shadcn` CLI's transitive `deepmerge`. It is a
  dev dependency used only at build time for its CSS import and is not shipped to the browser.

See [CLAUDE.md](CLAUDE.md) for engineering rules.
