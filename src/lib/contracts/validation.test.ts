import { describe, expect, it } from "vitest";

import { assignmentWarnings, exposureWarning, hourlyEconomics, recentMondays, timesheetSchema } from "./validation";

const base = { billRate: 75, payRate: 50, burdenPercent: 20, clientTermsDays: 30, payFrequency: "weekly", employmentModel: "w2_payroll_provider" };

describe("hourlyEconomics", () => {
  it("separates spread, estimated burden and net", () => {
    expect(hourlyEconomics(base)).toEqual({ spread: 25, burden: 10, net: 15, netMarginPercent: 20, markupPercent: 50 });
  });
});

describe("assignmentWarnings", () => {
  it("flags losing and thin rates", () => {
    expect(assignmentWarnings({ ...base, billRate: 50 })[0]).toMatchObject({ level: "danger" });
    expect(assignmentWarnings({ ...base, billRate: 58 })[0].message).toMatch(/loses/);
    expect(assignmentWarnings({ ...base, billRate: 64 })[0].message).toMatch(/Thin margin/);
  });

  it("explains the cash-flow gap", () => {
    const gap = assignmentWarnings({ ...base, clientTermsDays: 60 }).find((w) => w.message.startsWith("Cash-flow gap"));
    expect(gap).toMatchObject({ level: "warning" });
    expect(gap!.message).toContain("60 days");
  });

  it("cautions about 1099 classification", () => {
    expect(assignmentWarnings({ ...base, employmentModel: "1099" }).some((w) => /attorney/.test(w.message))).toBe(true);
  });
});

describe("exposureWarning", () => {
  it("escalates with size", () => {
    expect(exposureWarning(0, 1000)).toBeNull();
    expect(exposureWarning(30_000, 100_000)?.level).toBe("danger");
    expect(exposureWarning(600, 1000)?.level).toBe("warning");
  });
});

describe("timesheetSchema", () => {
  const ok = { assignmentId: crypto.randomUUID(), weekStart: "2026-11-02", regularHours: "40", overtimeHours: "2.5", submit: "true" };
  it("accepts a Monday with quarter hours", () => {
    expect(timesheetSchema.parse(ok)).toMatchObject({ regularHours: 40, overtimeHours: 2.5, submit: true });
  });
  it("rejects other days, odd fractions and empty weeks", () => {
    expect(timesheetSchema.safeParse({ ...ok, weekStart: "2026-11-03" }).success).toBe(false);
    expect(timesheetSchema.safeParse({ ...ok, regularHours: "40.1" }).success).toBe(false);
    expect(timesheetSchema.safeParse({ ...ok, regularHours: "0", overtimeHours: "0" }).success).toBe(false);
  });
});

describe("recentMondays", () => {
  it("lists Mondays from this week back to the start", () => {
    const weeks = recentMondays("2026-10-20", null, new Date("2026-11-08T12:00:00Z"));
    expect(weeks).toEqual(["2026-11-02", "2026-10-26", "2026-10-19"]);
  });
});
