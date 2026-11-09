import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let recruiter2: string;
let employer: string;
let candidateUser: string;
let company: string;
let job: string;
let application: string;
let application2: string;
let placement: string;
let placement2: string;
let invoice: string;
let commission: string;

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v);

async function newApplication(q: Query, first: string) {
  const [cand] = await q("insert into public.candidates (organization_id, first_name, last_name, created_by) values ($1, $2, 'Demo', auth.uid()) returning id", [org, first]);
  const [app] = await q(
    "insert into public.applications (organization_id, candidate_id, job_id, source, created_by) values ($1, $2, $3, 'recruiter', auth.uid()) returning id",
    [org, cand.id, job],
  );
  return app.id as string;
}

async function summary() {
  return db.asUser(admin, async (q) => {
    const [row] = await q("select * from public.finance_summary($1::date, $2::date)", [daysFromNow(-365), daysFromNow(365)]);
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, num(v)]));
  });
}

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r1@coretech.test", { appMeta: { invited: true }, userMeta: { full_name: "Riley One" } });
  recruiter2 = await db.createUser("r2@coretech.test", { appMeta: { invited: true } });
  employer = await db.createUser("e@company.test", { appMeta: { invited: true } });
  candidateUser = await db.createUser("cand@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'recruiter')", [recruiter2]);
    await q("select public.assign_role($1, 'employer')", [employer]);
  });
  await db.asUser(recruiter, async (q) => {
    [{ id: company }] = (await q("insert into public.companies (organization_id, name, created_by) values ($1, 'Client Co', auth.uid()) returning id", [org])) as { id: string }[];
    await q("select public.add_company_member($1, $2)", [company, employer]);
    [{ id: job }] = (await q(
      "insert into public.jobs (organization_id, company_id, title, status, created_by) values ($1, $2, 'Network Engineer', 'published', auth.uid()) returning id",
      [org, company],
    )) as { id: string }[];
    application = await newApplication(q, "Alex");
    application2 = await newApplication(q, "Blair");
  });
});

describe("placements", () => {
  it("requires Offer or Placed, and an admin", async () => {
    await db.asUser(admin, async (q) => {
      await expect(
        q("select public.create_placement($1, $2::date, $3::date, 120000, 'percentage', 20, null, 90, null)", [application, today(), daysFromNow(-30)]),
      ).rejects.toThrow(/Offer or Placed/);
    });
    await db.asUser(recruiter, async (q) => {
      await q("select public.move_application_stage($1, 'offer', null)", [application]);
      await q("select public.move_application_stage($1, 'offer', null)", [application2]);
      await expect(
        q("select public.create_placement($1, $2::date, $3::date, 120000, 'percentage', 20, null, 90, null)", [application, daysFromNow(-40), daysFromNow(-30)]),
      ).rejects.toThrow(/Only administrators/);
    });
  });

  it("computes the fee and guarantee end date", async () => {
    await db.asUser(admin, async (q) => {
      [{ id: placement }] = (await q(
        "select public.create_placement($1, $2::date, $3::date, 120000, 'percentage', 20, 999, 90, 'Great fit') as id",
        [application, daysFromNow(-40), daysFromNow(-30)],
      )) as { id: string }[];
      [{ id: placement2 }] = (await q(
        "select public.create_placement($1, $2::date, $3::date, 90000, 'flat', null, 15000, 60, null) as id",
        [application2, today(), daysFromNow(20)],
      )) as { id: string }[];
      await expect(
        q("select public.create_placement($1, $2::date, $3::date, 1, 'flat', null, 1, 1, null)", [application, today(), today()]),
      ).rejects.toThrow(/already has a placement/);
    });
    const [p] = await db.admin("select fee_amount, fee_flat, guarantee_ends_on::text as g from public.placements where id = $1", [placement]);
    expect(num(p.fee_amount)).toBe(24000);
    expect(p.fee_flat).toBeNull();
    expect(p.g).toBe(daysFromNow(60));
  });

  it("moves status forward only, with checks", async () => {
    await db.asUser(admin, async (q) => {
      await expect(q("select public.set_placement_status($1, 'started', null, null, null, null)", [placement2])).rejects.toThrow(/hasn't arrived/);
      await q("select public.set_placement_status($1, 'started', null, null, null, null)", [placement]);
      await expect(q("select public.set_placement_status($1, 'pending_start', null, null, null, null)", [placement])).rejects.toThrow(/can't move/);
    });
  });
});

describe("the four money buckets", () => {
  it("separates forecast from earned", async () => {
    const s = await summary();
    expect(s.forecast).toBe(15000); // placement2 hasn't started
    expect(s.earned).toBe(24000);
    expect(s.invoiced).toBe(0);
    expect(s.collected).toBe(0);
    expect(s.at_risk).toBe(24000); // still in its guarantee period
  });

  it("counts invoices only once sent, and payments as collected", async () => {
    await db.asUser(admin, async (q) => {
      [{ id: invoice }] = (await q(
        "select public.create_invoice($1, 'invoice', null, 24000, $2::date, $3::date, 'Placement fee') as id",
        [placement, today(), daysFromNow(30)],
      )) as { id: string }[];
    });
    expect((await summary()).invoiced).toBe(0);
    await db.asUser(admin, async (q) => {
      await expect(q("select public.record_payment($1, 100, $2::date, 'ach', null)", [invoice, today()])).rejects.toThrow(/sent/);
      await q("select public.mark_invoice_sent($1)", [invoice]);
      await q("select public.record_payment($1, 10000, $2::date, 'ach', 'ACH 1')", [invoice, today()]);
      await expect(q("select public.record_payment($1, 20000, $2::date, 'ach', null)", [invoice, today()])).rejects.toThrow(/balance due/);
      await expect(q("select public.record_payment($1, 10, $2::date, 'ach', null)", [invoice, daysFromNow(2)])).rejects.toThrow(/future/);
    });
    const [inv] = await db.admin("select status, invoice_number from public.invoices where id = $1", [invoice]);
    expect(inv.status).toBe("partially_paid");
    expect(inv.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
    const s = await summary();
    expect(s.invoiced).toBe(24000);
    expect(s.collected).toBe(10000);
    expect(s.outstanding).toBe(14000);
  });

  it("marks the invoice paid when the balance is cleared, and blocks voiding it", async () => {
    await db.asUser(admin, async (q) => {
      await q("select public.record_payment($1, 14000, $2::date, 'wire', null)", [invoice, today()]);
      await expect(q("select public.void_invoice($1, 'oops')", [invoice])).rejects.toThrow(/credit note/);
    });
    const [inv] = await db.admin("select status from public.invoices where id = $1", [invoice]);
    expect(inv.status).toBe("paid");
    expect((await summary()).outstanding).toBe(0);
  });
});

describe("commissions", () => {
  it("caps splits at 100% and only pays staff", async () => {
    await db.asUser(admin, async (q) => {
      await q("select public.set_commission($1, $2, 60, 10)", [placement, recruiter]);
      await expect(q("select public.set_commission($1, $2, 50, 10)", [placement, recruiter2])).rejects.toThrow(/100%/);
      await q("select public.set_commission($1, $2, 40, 10)", [placement, recruiter2]);
      await expect(q("select public.set_commission($1, $2, 10, 10)", [placement, employer])).rejects.toThrow(/recruiters or administrators/);
    });
  });

  it("derives status and amount; recruiters see only their own", async () => {
    await db.asUser(recruiter, async (q) => {
      const rows = await q("select id, amount, status, recruiter_name from public.commission_overview()");
      expect(rows).toHaveLength(1);
      commission = rows[0].id as string;
      expect(num(rows[0].amount)).toBe(1440); // 24000 × 60% × 10%
      expect(rows[0].status).toBe("payable"); // invoice paid in full
      expect(rows[0].recruiter_name).toBe("Riley One");
      // Credited placement visible, other placement and all invoices hidden.
      expect(await q("select id from public.placements")).toEqual([{ id: placement }]);
      expect(await q("select id from public.invoices")).toHaveLength(0);
      expect(await q("select id from public.payments")).toHaveLength(0);
      await expect(q("select * from public.finance_summary(current_date - 30, current_date)")).rejects.toThrow(/Only administrators/);
      await expect(q("select public.mark_commission_paid($1, current_date, 1440)", [commission])).rejects.toThrow(/Only administrators/);
    });
    await db.asUser(admin, async (q) => {
      expect(await q("select id from public.commission_overview()")).toHaveLength(2);
      await q("select public.mark_commission_paid($1, current_date, 1440)", [commission]);
      await expect(q("select public.remove_commission($1)", [commission])).rejects.toThrow(/paid commission/);
    });
  });

  it("hides all finance data from employers and candidates", async () => {
    for (const user of [employer, candidateUser]) {
      await db.asUser(user, async (q) => {
        for (const table of ["placements", "commissions", "invoices", "payments"]) {
          expect(await q(`select 1 from public.${table}`), table).toHaveLength(0);
        }
        expect(await q("select * from public.commission_overview()")).toHaveLength(0);
        await expect(q("select public.create_invoice($1, 'invoice', null, 1, current_date, current_date, 'x')", [placement])).rejects.toThrow(/Only administrators/);
      });
    }
    await db.asAnon(async (q) => {
      await expect(q("select 1 from public.invoices")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("fall-offs, refunds and replacements", () => {
  it("records a partial refund that reduces earned revenue and commission", async () => {
    await db.asUser(admin, async (q) => {
      await expect(q("select public.set_placement_status($1, 'fell_off', current_date, 'Left', 'refund', 99999)", [placement])).rejects.toThrow(/refund between/);
      await q("select public.set_placement_status($1, 'fell_off', current_date, 'Left in week 5', 'partial_refund', 6000)", [placement]);
    });
    const s = await summary();
    expect(s.earned).toBe(18000);
    expect(s.refunds_owed).toBe(6000);

    let cn = "";
    await db.asUser(admin, async (q) => {
      await expect(
        q("select public.create_invoice($1, 'credit_note', $2, 30000, current_date, current_date, 'Refund')", [placement, invoice]),
      ).rejects.toThrow(/can't exceed/);
      [{ id: cn }] = (await q("select public.create_invoice($1, 'credit_note', $2, 6000, current_date, current_date, 'Partial refund') as id", [placement, invoice])) as { id: string }[];
      await q("select public.mark_invoice_sent($1)", [cn]);
      await q("select public.record_payment($1, 6000, current_date, 'ach', 'Refund wire')", [cn]);
    });
    const after = await summary();
    expect(after.invoiced).toBe(18000); // 24000 − 6000 credit
    expect(after.collected).toBe(18000); // 24000 received − 6000 refunded
    expect(after.refunds_owed).toBe(0);

    await db.asUser(recruiter2, async (q) => {
      const [row] = await q("select amount, status from public.commission_overview()");
      expect(num(row.amount)).toBe(720); // (24000 − 6000) × 40% × 10%
    });
  });

  it("links a replacement only for replacement fall-offs at the same company", async () => {
    await db.asUser(admin, async (q) => {
      await expect(q("select public.link_replacement($1, $2)", [placement, placement2])).rejects.toThrow(/resolved by replacement/);
    });
  });

  it("audits finance changes", async () => {
    const rows = await db.admin("select action from public.audit_log where entity_type in ('placement', 'invoice')");
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["placement.created", "placement.status_changed", "invoice.created", "invoice.sent", "payment.recorded", "commission.paid"]));
  });
});
