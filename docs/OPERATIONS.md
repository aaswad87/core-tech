# Running CoreTech Recruiting — backups, monitoring and incidents

## Backups

What needs protecting: the **database** (everything except files) and **resume files** in Supabase Storage.
Supabase database backups do **not** include Storage files, so the two are handled separately.

| What | How | How often | Kept |
|---|---|---|---|
| Database | Supabase **Pro** daily backups (Project → Database → Backups). Add **Point-in-Time Recovery** if you can't afford to lose up to a day of work. | Daily (automatic) | 7+ days |
| Database (off-site copy) | `npx supabase db dump --linked -f backup-YYYY-MM-DD.sql` (schema) and `npx supabase db dump --linked --data-only -f data-YYYY-MM-DD.sql`; store encrypted (e.g. a password-protected archive in a business cloud drive with restricted access) | Weekly | 12 weeks |
| Resume files | Supabase Storage → `resumes` bucket. Download with the Supabase CLI or the S3-compatible endpoint (Project Settings → Storage) to the same encrypted location | Weekly | 12 weeks |
| Code | GitHub (every change) | Continuous | Forever |
| Settings | Export the Vercel environment variable *names* (not values) into a private note; keep secret values in a password manager | On change | — |

Backups contain personal data: keep them encrypted, limit who can open them, and delete old copies on schedule.
A candidate's deletion request also applies to backups — they age out within the retention period above.

### Restore (practice this once a quarter)
1. Create a **new** Supabase project (never restore over production first).
2. Restore the backup into it (Supabase dashboard → Backups → Restore, or `psql` with the dump files).
3. Point a Vercel *preview* deployment at it (preview environment variables) and check sign-in, a candidate,
   a job and an invoice.
4. Only if production is lost or corrupted: restore into production during a quiet period, after telling users.

## Monitoring

| Watch | Tool | Alert when |
|---|---|---|
| Site up and database reachable | An uptime monitor (e.g. UptimeRobot or Better Stack free tier) on `https://<domain>/api/health` every 5 min | Non-200 twice in a row → email + SMS to the admin |
| Errors | Vercel → Project → **Logs** (filter `error`). Error pages show a *Reference* code — search the logs for it | Review daily during the first weeks, then weekly |
| Database & auth | Supabase → **Logs** and **Reports**; Supabase **usage** emails | Database CPU/disk near plan limits; spikes in failed sign-ins |
| Email delivery | Resend → **Emails / Domains**; each interview's **Email log** in the app | Bounces or complaints rising; domain no longer verified |
| Job Radar | Recruiter → Job Radar shows the last scan; Vercel → **Cron Jobs** | Last scan more than 6 hours old |
| Spending | Spend limits/alerts in Vercel, Supabase, Resend and OpenAI dashboards | Any unexpected jump |
| Access | `audit_log` (SQL below) | Role changes you didn't make; unusual resume views |

Useful admin queries (Supabase → SQL Editor):

```sql
-- Role changes in the last 30 days
select created_at, actor_id, action, details from public.audit_log
where action like 'role.%' and created_at > now() - interval '30 days' order by created_at desc;

-- Who viewed resumes shared with employers this week
select created_at, actor_id, entity_id as submission_id from public.audit_log
where action = 'submission.resume_viewed' and created_at > now() - interval '7 days' order by created_at desc;

-- Failed emails this week
select created_at, recipient, subject, error from public.notification_deliveries
where status = 'failed' and created_at > now() - interval '7 days' order by created_at desc;
```

## Incident response checklist

Severity: **Sev 1** — data exposed or site down; **Sev 2** — a major feature broken (sign-in, applications);
**Sev 3** — minor bug.

1. **Write it down.** Start a dated incident note: what was seen, when, by whom. Keep adding to it.
2. **Contain** (Sev 1 — do what applies, now):
   - Suspected leaked key → rotate it: Supabase secret key (Project Settings → API Keys → create a new secret key,
     update Vercel, redeploy, then delete the old one), `CRON_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`.
   - Compromised user account → remove their roles at **Users** (access ends immediately); in Supabase →
     Authentication → Users, sign the user out of all sessions / ban them.
   - A feature leaking data → roll back to the last good deployment (Vercel → Instant Rollback).
   - AI-related issue → set `AI_PRIVACY_REVIEW_APPROVED` to empty in Vercel and redeploy (turns AI off).
   - Site under attack → enable Vercel's Attack Challenge Mode / firewall rules.
3. **Assess.** Use Vercel logs, Supabase logs and `audit_log` to work out what happened, which records were
   involved and whose data. Preserve logs (export them) before they roll over.
4. **Notify.** If personal information may have been exposed, contact your attorney the same day. Texas law
   requires notifying affected individuals and, above a threshold, the Texas Attorney General within fixed
   deadlines; other states and client contracts may add requirements. Tell affected clients as your contracts require.
5. **Recover.** Fix the cause (new migration and/or code), restore data from backup if needed (restore drill above),
   and verify with the tests (`npm run check`).
6. **Review** within a week: what happened, why, what changes prevent it (add a test to
   `tests/db/security-invariants.test.ts` or the relevant suite), and close the incident note.

Keep this list where admins can find it offline (printed or in a shared drive), along with contact details for
your attorney, Vercel support, Supabase support and your domain registrar.
