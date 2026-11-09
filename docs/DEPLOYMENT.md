# Going live — deployment guide

This takes CoreTech Recruiting from this computer to a live site on your own domain. Follow the steps in order.
Nothing here deploys by itself: each step is something an operator does, and production data is never changed
without you deciding to.

**You'll need accounts with:** GitHub (stores the code), Vercel (runs the website), Supabase (database — you
already have one), a domain registrar (e.g. Cloudflare, Namecheap, GoDaddy), and Resend (sends email).

**Costs to check before you start** (prices change — confirm on each site): Vercel's free *Hobby* plan is for
non-commercial use, so a business site needs **Vercel Pro**; it's also what allows the Job Radar scan to run every
2 hours. **Supabase Pro** is strongly recommended for production because it adds daily backups (see
[OPERATIONS.md](OPERATIONS.md)). Resend's free tier covers low email volume. The domain is a yearly fee.

---

## 1. Put the code on GitHub (private)

1. Create a **private** repository on GitHub named `coretech-recruiting` (no README, no .gitignore — the project has them).
2. From the project folder:
   ```bash
   git init
   git add .
   git commit -m "CoreTech Recruiting"
   git branch -M main
   git remote add origin https://github.com/<your-account>/coretech-recruiting.git
   git push -u origin main
   ```
   `.env.local`, `.env*` files, `.next/` and `node_modules/` are excluded by `.gitignore` — secrets never go to GitHub.
   Before the first push, run `git status` and confirm no `.env` file is listed.

## 2. Prepare the production database (Supabase)

You can use your existing project (`hcemrwnrciefoqrstayb`) as production. If you'd rather keep it for testing,
create a new project and run `supabase/manual/all-migrations.sql` there instead of the update files.

1. **Bring the schema up to date.** In **SQL Editor → New query**, run each file in `supabase/manual/` that you
   haven't run yet, **in order**: `update-phase-9-interviews.sql`, `update-phase-10-finance.sql`,
   `update-phase-11-contracts.sql`, `update-phase-12-ai.sql`, `update-phase-13-security.sql`.
   Each should end with *Success. No rows returned*. **Never run `supabase/seed.sql` in production** — it's demo data.
2. **Authentication → URL Configuration**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/confirm` (keep `http://localhost:3100/auth/confirm` only if you
     still develop against this project).
3. **Authentication → Providers → Email:** *Confirm email* on. **Authentication → Policies / Password:** minimum
   length 10, require lowercase, uppercase and digits, and turn on **leaked password protection** if your plan has it.
4. **Authentication → Email Templates:** use the two templates in the README (*Supabase setup*, step 5).
5. **Authentication → SMTP Settings:** send auth emails through Resend (step 5 below) — Supabase's built-in email
   is rate-limited and meant for testing only.
6. **Project Settings → API Keys:** copy the Project URL, the publishable key and a **secret** key for step 3.
   The secret key bypasses all access rules: store it only in Vercel's environment variables.
7. **Admins:** after launch, turn on multi-factor authentication for every administrator account (Authentication →
   Multi-Factor), and make sure only you can sign in to the Supabase dashboard (Organization → Team).

## 3. Create the Vercel project

1. In Vercel: **Add New → Project → Import** the GitHub repository. Framework: Next.js (detected). Leave build
   settings at their defaults.
2. **Region:** Project Settings → Functions → choose the region closest to your Supabase project's region
   (e.g. *Washington, D.C. (iad1)* for US East).
3. **Environment variables** (Project Settings → Environment Variables → *Production*). Set:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` | No trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Public |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | **Secret.** Inquiry forms, Job Radar scan |
| `CRON_SECRET` | 32+ random characters | **Secret.** Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RESEND_API_KEY` | `re_…` | **Secret.** After step 5 |
| `MARKET_ALERTS_FROM` | `CoreTech Recruiting <notifications@<your-domain>>` | Must be on the domain verified in Resend |
| `JSEARCH_RAPIDAPI_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | optional | Job Radar sources |
| `SLACK_MARKET_WEBHOOK_URL` | optional | Job Radar team alerts |
| `AI_PRIVACY_REVIEW_APPROVED`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_MONTHLY_TOKEN_BUDGET` | leave empty until the privacy review | See README → AI resume parsing |
| `ANDROID_TWA_PACKAGE_NAME`, `ANDROID_TWA_SHA256_FINGERPRINTS` | later | Only when publishing the Android app |

   Never put a secret in a variable whose name starts with `NEXT_PUBLIC_` — those are sent to every visitor.
4. **Check before deploying:** copy the same values into a local file named `.env.production.local` (it's
   git-ignored) and run `npm run preflight`. Fix every **FAIL**; read every **WARN**. Delete the file afterwards
   if you don't want secrets on this computer.
5. **Deploy.** The first deployment gets a `*.vercel.app` address. Open `https://<that-address>/api/health` — it
   should show `"status":"ok"`.

## 4. Connect your domain

1. Vercel → Project → **Settings → Domains → Add** `yourdomain.com` and `www.yourdomain.com`. Choose which one
   redirects to the other (we suggest `www` → apex).
2. Vercel shows the exact DNS records to add. Typically:
   - apex `yourdomain.com`: an **A** record to the IP Vercel shows
   - `www`: a **CNAME** to the target Vercel shows

   Add them at your registrar's DNS settings. Use the values Vercel displays, not values copied from elsewhere.
3. Wait until Vercel shows **Valid Configuration** (minutes to a few hours). HTTPS certificates are automatic.
4. Make sure `NEXT_PUBLIC_SITE_URL` matches the final address exactly, then **Redeploy** (public variables are
   built into the site).
5. Update Supabase's Site URL and Redirect URLs to the same address (step 2.2) if you used the vercel.app address.

## 5. Email (Resend) and DNS

1. In Resend → **Domains → Add Domain** → your domain (or a subdomain like `mail.yourdomain.com`, which keeps
   marketing and app email separate).
2. Resend shows DNS records — usually an **SPF** TXT record, **DKIM** record(s) and an **MX** record for bounces.
   Add them exactly as shown at your registrar, then click **Verify**.
3. Add a **DMARC** record so receivers can trust your mail: TXT record at `_dmarc.yourdomain.com` with
   `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`. After a few weeks of clean reports, tighten to
   `p=quarantine`.
4. Create an API key (Sending access only) → `RESEND_API_KEY` in Vercel; set `MARKET_ALERTS_FROM`.
5. **Supabase auth emails through Resend:** Supabase → Authentication → SMTP Settings → enable custom SMTP:
   host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key, sender
   `CoreTech Recruiting <no-reply@yourdomain.com>`.
6. Test: sign up a new test account and confirm the email arrives (check spam), then schedule a test interview
   with "Email the candidate" ticked and check the interview's **Email log** shows *sent*.

## 6. Launch checklist

- [ ] `npm run preflight` on the production values: no FAIL
- [ ] `https://<domain>/api/health` returns `ok`
- [ ] All `supabase/manual/update-phase-*.sql` files run; `seed.sql` **not** run
- [ ] Sign up → confirm email → sign in works on the real domain
- [ ] First administrator created (README → Supabase setup, step 6) and MFA turned on
- [ ] Recruiter, employer and candidate test accounts each see only their own area (then remove the test data)
- [ ] Privacy notice and terms reviewed by a lawyer; `LEGAL_REVIEWED = true` in `src/components/marketing/legal-page.tsx`
- [ ] Contact form submits and the lead appears under **Leads**
- [ ] Uptime monitor and backups set up ([OPERATIONS.md](OPERATIONS.md))
- [ ] Supabase Pro (backups) and Vercel Pro (commercial use, cron frequency) active
- [ ] Optional: Google Search Console with `https://<domain>/sitemap.xml`

## 7. Changing the app after launch

- **Code:** push to `main` → Vercel builds and deploys automatically. Each push to another branch gets a preview
  URL first. Run `npm run check` before pushing.
- **Database changes:** every change is a new file in `supabase/migrations/` (never edit one that's already been
  applied). Test it with `npm run test:db`, take a backup, then apply it to production — paste it into the SQL
  editor (as with the update files) or use the Supabase CLI (`npx supabase link --project-ref <ref>` then
  `npx supabase db push`). Apply database changes **before** deploying code that needs them.
- **Rollback:** Vercel → Deployments → pick the last good one → **Instant Rollback**. Database changes aren't rolled
  back automatically; fix forward with a new migration, or restore a backup ([OPERATIONS.md](OPERATIONS.md)).
