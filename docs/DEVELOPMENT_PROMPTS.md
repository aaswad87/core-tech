# CoreTech Recruiting — Sequential Claude Code Development Prompts

Use these prompts one at a time after the Master Build Prompt. Ask Claude Code to inspect existing work before every phase and preserve functioning code.

## Prompt 1 — Foundation and brand
Implement the Next.js App Router + TypeScript foundation, Tailwind, shadcn/ui, brand tokens, reusable layout, responsive navigation, Supabase client/server setup, `.env.example`, README, and CLAUDE.md. Do not add fake integrations. Run lint, typecheck, and build.

## Prompt 2 — Database, authentication, and authorization
Create Supabase migrations for organizations, profiles, roles, user_roles, companies, company_members, and the core recruiting entities. Implement secure signup/login/logout/password reset, invitation or admin-controlled role assignment, server-side authorization, RLS, and tests proving employer company isolation and candidate privacy. Never permit self-assigned admin roles.

## Prompt 3 — Public corporate website
Build polished pages: Home, About, Services, IT Recruiting, Networking, Cybersecurity, Cloud, Telecommunications, Employers, Candidates, Jobs, Contact, Privacy, and Terms. Add accessible lead forms, SEO metadata, sitemap, robots, responsive layouts, and real server-side form persistence. Public jobs must expose only approved published fields.

## Prompt 4 — Recruiter ATS and candidate CRM
Build candidate list/detail, create/edit, skills, certifications, work history, tags, notes, activity history, duplicate warnings, search, filters, pagination, and candidate ownership. Add private PDF/DOCX resume upload with server-side file validation and private Supabase storage. Ensure candidate notes are internal-only. Add tests.

## Prompt 5 — Job management and applications
Build job creation/editing, draft/pending/published/paused/closed/archived statuses, required and preferred skills, salary/rate ranges, location, work arrangement, job board, job detail pages, candidate applications, and application history. Enforce authorization and prevent inappropriate duplicate active applications/submissions.

## Prompt 6 — Recruiting pipeline
Build Kanban and table views for New, Screening, Recruiter Interview, Technical Evaluation, Submitted to Client, Client Interview, Offer, Placed/Hired, Rejected, Withdrawn, On Hold, and Future Opportunity. Record actor, timestamps, previous/new stage, and reason. Require permissions for stage transitions and log important changes.

## Prompt 7 — Employer portal
Build company profile and member management, job requests, own job listings, explicit candidate submissions, authorized resume viewing, interview requests, and feedback. Test with at least two employer companies and prove there is no cross-company access. Do not expose recruiter notes or unrelated candidate records.

## Prompt 8 — Candidate portal
Build candidate profile, resume management, job search, applications, own application tracking, permitted interview information, communication preferences, and privacy request workflow. Test that Candidate A cannot access Candidate B's data or internal notes.

## Prompt 9 — Interview management and notifications
Build interview scheduling with timezone, interviewer, candidate, job, meeting link, status, feedback, outcome, and rescheduling. Add transactional email templates through Resend only after configuration. Log delivery outcomes; do not claim delivery without provider confirmation.

## Prompt 10 — Direct-hire finance
Build placement records, agreed fee percentage/amount, salary basis, invoice creation, payment reconciliation, guarantee dates, replacement/refund tracking, and recruiter commissions. Clearly distinguish forecast, earned, invoiced, and collected amounts. Restrict finance data by role.

## Prompt 11 — Contract staffing foundation
Build assignment, worker, client, dates, bill rate, pay rate, timesheets, approvals, invoice items, and payroll-status tracking. Calculate billings, worker gross pay, gross spread, and estimated employer burden separately. Do not implement or claim live payroll without a verified provider and legal/payroll review. Add warnings for cash-flow exposure.

## Prompt 12 — AI resume parsing and matching
Only after privacy and security review, integrate a server-side AI provider. Parse resume text into proposed structured fields with evidence and confidence/uncertainty; require recruiter review before saving. Compare job-related skills and experience with explicit evidence and missing requirements. No protected characteristics, proxies, automated rejection, or final hiring recommendations. Add rate limits, cost limits, logging, and failure handling.

## Prompt 13 — Production security and QA
Perform a security and quality audit. Test authentication, role escalation, RLS, IDOR, employer isolation, candidate privacy, resume storage, signed URL expiry, input validation, rate limits, audit logs, accessibility, mobile layouts, and error handling. Run unit, integration, end-to-end, lint, typecheck, and production build. Fix critical/high severity findings and document remaining risks.

## Prompt 14 — Deployment
Prepare Vercel deployment, Supabase production configuration, migration workflow, environment variables, domain setup, email DNS guidance, backup/restore plan, monitoring, incident response checklist, and admin guide. Do not deploy or change production data without explicit operator approval.
