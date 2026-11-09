# CoreTech Recruiting — administrator guide

A practical guide to running the business on the platform. Technical setup is in [DEPLOYMENT.md](DEPLOYMENT.md);
backups, monitoring and incidents are in [OPERATIONS.md](OPERATIONS.md).

## Who can do what

| Role | Gets it how | Works in |
|---|---|---|
| **Administrator** | First one by SQL (README → Supabase setup, step 6); then by another admin | Everything, plus Users, Privacy, Finance, Contracts |
| **Recruiter** | An admin, at **Users** | Candidates, Jobs, Pipeline, Interviews, Companies, Job Radar, Leads, own Commissions |
| **Employer** (client) | An admin gives the role; a recruiter adds them to a company | `/employer` — only their own company |
| **Candidate** | Automatic on sign-up | `/candidate` — only their own profile and applications |

Nobody can change their own roles. Every role change is recorded.

## Adding people

- **A recruiter:** they sign up at `/signup` and confirm their email → you open **Users**, find them, add
  **Recruiter**. (Removing *Candidate* from staff accounts is optional.)
- **A client's hiring manager:** they sign up → you add **Employer** at **Users** → a recruiter opens
  **Companies → (the company) → Employer portal access** and adds their email as *Owner* or *Member*. Owners can
  later ask for teammates from their portal; those requests appear on the company page.
- **Removing access:** remove the role at **Users** — access ends immediately, even if they're still listed on a company.

## A typical direct-hire search

1. **Job:** a client sends a job request from their portal (or you create the job) → **Companies** shows the
   request → *Create draft job* → fill in the public summary and skills → **Publish**. It appears on `/jobs`.
2. **Candidates:** they apply on the site, or you add them under **Candidates** (upload the resume; optionally
   *Suggest profile details* if AI is turned on — always check the suggestions).
3. **Pipeline:** move applications through the stages. *Compare to job* shows which required skills have evidence
   in the record.
4. **Submit to the client:** only after the candidate agrees to be put forward **for that specific job**. On the
   pipeline, *Submit to client* records their consent and the summary the client will see. Then, on the company
   page, choose which resume (if any) the client may open.
5. **Interviews:** the client requests times in their portal → **Interviews** → *Schedule it*, confirm the time
   with the candidate, tick *Email the candidate* if email is set up. Record the outcome afterwards.
6. **Offer and placement:** move to **Offer**/**Placed** → **Finance** → *Record placement* with the agreed fee.
   Mark it *Started* on the start date, invoice the client, record payments as they arrive, credit recruiters.

## Contract staffing

Under **Contracts**. Read the yellow notice on every page: the platform **tracks** contract work but does not run
payroll. Create the assignment (rates, client terms), enter each week's hours and send them for client approval,
invoice approved weeks, and record what your payroll provider did. Watch the **cash exposure** figure — it's
money you've committed to workers that clients haven't paid yet.

## Requests that need an admin

- **Privacy requests** (`/admin/privacy`): a candidate asked for a copy, correction, deletion, or no contact.
  Reply to them by email, do the work, then record the outcome and a short reply they'll see. Deletion: remove
  the candidate under **Candidates** (admins only) and their account in Supabase → Authentication → Users.
- **Leads** (`/admin/leads`): inquiries from the website's contact and hiring forms.

## Settings that live outside the app

| Setting | Where |
|---|---|
| Email sending (interview emails, Job Radar alerts) | Resend + Vercel environment variables |
| AI resume suggestions on/off and limits | Vercel environment variables (`AI_*`, `OPENAI_*`) — only after the privacy review |
| Job Radar data sources | Vercel environment variables (`JSEARCH_*`, `ADZUNA_*`) |
| Who can sign in to the Supabase dashboard | Supabase → Organization → Team |
| Legal pages' draft banner | `LEGAL_REVIEWED` in the code (after legal review) |

After changing a Vercel environment variable, **redeploy** for it to take effect.

## Good habits

- Turn on multi-factor authentication for every admin and use a password manager.
- Give people the lowest role that lets them work; remove access the day someone leaves.
- Never paste candidate data into outside tools (chat apps, personal email, unapproved AI tools).
- Never load the demo seed data into production, and label anything that's sample data.
- AI suggestions are suggestions: check them against the resume quotes. The app never decides who is hired,
  and neither should a tool — a person makes every employment decision.
- Review the audit queries in [OPERATIONS.md](OPERATIONS.md) monthly.
