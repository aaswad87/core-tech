import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let employerA: string;
let employerB: string;
let workerUser: string;
let companyA: string;
let companyB: string;
let worker: string;
let assignment: string;
let week1: string;
let week2: string;
let invoice: string;

const num = (v: unknown) => Number(v);

/** The Monday `weeksAgo` weeks before this week's Monday (UTC). */
function monday(weeksAgo: number): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
}

async function saveAssignment(q: Query, id: string | null, overrides: Partial<{ company: string; bill: number; pay: number }> = {}) {
  const [row] = await q(
    `select public.save_assignment($1, $2, $3, null, 'Network Technician', 'w2_payroll_provider', $4::date, null,
       $5, $6, 1.5, 1.5, 20, 30, 'weekly', null) as id`,
    [id, worker, overrides.company ?? companyA, monday(8), overrides.bill ?? 75, overrides.pay ?? 50],
  );
  return row.id as string;
}

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r@coretech.test", { appMeta: { invited: true } });
  employerA = await db.createUser("a@client-a.test", { appMeta: { invited: true } });
  employerB = await db.createUser("b@client-b.test", { appMeta: { invited: true } });
  workerUser = await db.createUser("worker@example.test", { userMeta: { full_name: "Wes Worker" } });
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'employer')", [employerA]);
    await q("select public.assign_role($1, 'employer')", [employerB]);
  });
  await db.asUser(recruiter, async (q) => {
    [{ id: companyA }] = (await q("insert into public.companies (organization_id, name, created_by) values ($1, 'Client A', auth.uid()) returning id", [org])) as { id: string }[];
    [{ id: companyB }] = (await q("insert into public.companies (organization_id, name, created_by) values ($1, 'Client B', auth.uid()) returning id", [org])) as { id: string }[];
    await q("select public.add_company_member($1, $2)", [companyA, employerA]);
    await q("select public.add_company_member($1, $2)", [companyB, employerB]);
    [{ id: worker }] = (await q(
      "insert into public.candidates (organization_id, first_name, last_name, created_by) values ($1, 'Wes', 'Worker', auth.uid()) returning id",
      [org],
    )) as { id: string }[];
  });
});

describe("assignments", () => {
  it("are admin-only", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(saveAssignment(q, null)).rejects.toThrow(/Only administrators/);
    });
    await db.asUser(admin, async (q) => {
      assignment = await saveAssignment(q, null);
      await expect(q("select public.save_timesheet($1, $2::date, 40, 0, null, true)", [assignment, monday(1)])).rejects.toThrow(/active/);
      await q("select public.set_assignment_status($1, 'active')", [assignment]);
      await expect(q("select public.set_assignment_status($1, 'pending')", [assignment])).rejects.toThrow(/can't move/);
    });
  });
});

describe("timesheets and the money math", () => {
  it("validates the week", async () => {
    await db.asUser(admin, async (q) => {
      const tuesday = new Date(`${monday(1)}T00:00:00Z`);
      tuesday.setUTCDate(tuesday.getUTCDate() + 1);
      await expect(q("select public.save_timesheet($1, $2::date, 40, 0, null, true)", [assignment, tuesday.toISOString().slice(0, 10)])).rejects.toThrow(/Monday/);
      await expect(q("select public.save_timesheet($1, $2::date, 40, 0, null, true)", [assignment, monday(20)])).rejects.toThrow(/outside/);
      await expect(q("select public.save_timesheet($1, $2::date, 90, 0, null, true)", [assignment, monday(1)])).rejects.toThrow();
    });
  });

  it("computes billing, gross pay, spread and estimated burden separately", async () => {
    await db.asUser(admin, async (q) => {
      [{ id: week1 }] = (await q("select public.save_timesheet($1, $2::date, 40, 5, null, true) as id", [assignment, monday(2)])) as { id: string }[];
      [{ id: week2 }] = (await q("select public.save_timesheet($1, $2::date, 32, 0, 'Holiday Thursday', true) as id", [assignment, monday(1)])) as { id: string }[];
    });
    const [t] = await db.admin("select billing, gross_pay from public.timesheets where id = $1", [week1]);
    // 40×75 + 5×75×1.5 = 3562.50 ; 40×50 + 5×50×1.5 = 2375
    expect(num(t.billing)).toBe(3562.5);
    expect(num(t.gross_pay)).toBe(2375);
  });

  it("snapshots rates so later changes don't rewrite approved weeks", async () => {
    await db.asUser(employerA, (q) => q("select public.review_timesheet($1, true, null)", [week1]));
    await db.asUser(admin, async (q) => {
      await saveAssignment(q, assignment, { bill: 90, pay: 55 });
      await expect(q("select public.save_timesheet($1, $2::date, 1, 0, null, true)", [assignment, monday(2)])).rejects.toThrow(/already approved/);
    });
    const [t] = await db.admin("select bill_rate, billing from public.timesheets where id = $1", [week1]);
    expect(num(t.bill_rate)).toBe(75);
    expect(num(t.billing)).toBe(3562.5);
  });
});

describe("approvals", () => {
  it("lets only the client (or an admin with a note) approve or reject", async () => {
    await db.asUser(employerB, async (q) => {
      await expect(q("select public.review_timesheet($1, true, null)", [week2])).rejects.toThrow(/not found/);
      expect(await q("select * from public.company_timesheets($1)", [companyA])).toHaveLength(0);
    });
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.review_timesheet($1, true, 'ok')", [week2])).rejects.toThrow(/not found/);
    });
    await db.asUser(employerA, async (q) => {
      await expect(q("select public.review_timesheet($1, false, ' ')", [week2])).rejects.toThrow(/what needs to change/);
      await q("select public.review_timesheet($1, false, 'Thursday was a holiday, should be 32 with OT 0 — please confirm')", [week2]);
    });
    await db.asUser(admin, async (q) => {
      await q("select public.save_timesheet($1, $2::date, 32, 0, 'Confirmed with client', true)", [assignment, monday(1)]);
      await expect(q("select public.review_timesheet($1, true, '')", [week2])).rejects.toThrow(/how the client approved/);
      await q("select public.review_timesheet($1, true, 'Approved by A. Client by email')", [week2]);
    });
    const rows = await db.admin("select status, approved_by_kind, payroll_status from public.timesheets order by week_start");
    expect(rows).toEqual([
      { status: "approved", approved_by_kind: "client", payroll_status: "ready" },
      { status: "approved", approved_by_kind: "staff", payroll_status: "ready" },
    ]);
  });

  it("shows the client hours and billing but never pay rate or margin", async () => {
    await db.asUser(employerA, async (q) => {
      const rows = await q("select * from public.company_timesheets($1)", [companyA]);
      expect(rows).toHaveLength(2);
      for (const key of ["pay_rate", "gross_pay", "burden_percent"]) expect(rows[0]).not.toHaveProperty(key);
      expect(rows[0].worker_name).toBe("Wes W.");
      expect(await q("select id from public.timesheets")).toHaveLength(0);
      expect(await q("select id from public.contract_assignments")).toHaveLength(0);
    });
  });
});

describe("invoicing and cash-flow exposure", () => {
  it("shows exposure on approved but unpaid weeks", async () => {
    await db.asUser(admin, async (q) => {
      const [row] = await q("select billing, gross_pay, spread, est_burden, net_margin, uninvoiced_billing, exposure from public.contract_overview()");
      // week1 3562.50 / 2375 ; week2 at new rates 32×90 = 2880 / 32×55 = 1760
      expect(num(row.billing)).toBe(6442.5);
      expect(num(row.gross_pay)).toBe(4135);
      expect(num(row.spread)).toBe(2307.5);
      expect(num(row.est_burden)).toBe(827); // 20% of gross pay
      expect(num(row.net_margin)).toBe(1480.5);
      expect(num(row.uninvoiced_billing)).toBe(6442.5);
      expect(num(row.exposure)).toBe(4962); // gross pay × 1.2
    });
  });

  it("bills approved weeks once, and releases them if the invoice is voided", async () => {
    await db.asUser(admin, async (q) => {
      [{ id: invoice }] = (await q("select public.create_contract_invoice($1, array[$2, $3]::uuid[], current_date, current_date + 30) as id", [assignment, week1, week2])) as { id: string }[];
      await expect(q("select public.create_contract_invoice($1, array[$2]::uuid[], current_date, current_date + 30)", [assignment, week1])).rejects.toThrow(/not be invoiced yet/);
    });
    const [inv] = await db.admin("select amount, assignment_id, description from public.invoices where id = $1", [invoice]);
    expect(num(inv.amount)).toBe(6442.5);
    expect(inv.assignment_id).toBe(assignment);
    expect(inv.description).toMatch(/2 weeks/);

    await db.asUser(admin, (q) => q("select public.void_invoice($1, 'Wrong PO number')", [invoice]));
    expect(await db.admin("select id from public.timesheets where invoice_id is not null")).toHaveLength(0);

    await db.asUser(admin, async (q) => {
      [{ id: invoice }] = (await q("select public.create_contract_invoice($1, array[$2, $3]::uuid[], current_date, current_date + 30) as id", [assignment, week1, week2])) as { id: string }[];
      await q("select public.mark_invoice_sent($1)", [invoice]);
      await q("select public.record_payment($1, 6442.5, current_date, 'ach', null)", [invoice]);
      const [row] = await q("select exposure, uninvoiced_billing from public.contract_overview()");
      expect(num(row.exposure)).toBe(0);
      expect(num(row.uninvoiced_billing)).toBe(0);
    });
  });
});

describe("payroll status is tracking only", () => {
  it("records what the provider did, with a reference when paid", async () => {
    await db.asUser(admin, async (q) => {
      await q("select public.set_payroll_status($1, 'sent_to_provider', 'Batch 2026-45')", [week1]);
      await expect(q("select public.set_payroll_status($1, 'paid_by_provider', '')", [week1])).rejects.toThrow(/reference/);
      await q("select public.set_payroll_status($1, 'paid_by_provider', 'Run 4512')", [week1]);
    });
    await db.asUser(employerA, async (q) => {
      await expect(q("select public.set_payroll_status($1, 'ready', null)", [week1])).rejects.toThrow(/Only administrators/);
    });
  });

  it("keeps everything from recruiters, other employers, workers and anonymous users", async () => {
    for (const user of [recruiter, employerB, workerUser]) {
      await db.asUser(user, async (q) => {
        expect(await q("select id from public.contract_assignments")).toHaveLength(0);
        expect(await q("select id from public.timesheets")).toHaveLength(0);
        await expect(q("select * from public.contract_overview()")).rejects.toThrow(/Only administrators/);
      });
    }
    await db.asAnon(async (q) => {
      await expect(q("select id from public.timesheets")).rejects.toThrow(/permission denied/);
    });
  });
});
