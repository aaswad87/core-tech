import { describe, expect, it } from "vitest";

import { computeFee, invoiceSchema, placementTermsSchema, statusChangeSchema, usd } from "./validation";

const terms = {
  offerAcceptedOn: "2026-11-01",
  startDate: "2026-12-01",
  baseSalary: "$120,000",
  feeType: "percentage",
  feePercent: "20",
  guaranteeDays: "90",
};

describe("placementTermsSchema", () => {
  it("parses money and requires the matching fee field", () => {
    expect(placementTermsSchema.parse(terms).baseSalary).toBe(120000);
    expect(placementTermsSchema.safeParse({ ...terms, feePercent: "" }).success).toBe(false);
    expect(placementTermsSchema.safeParse({ ...terms, feeType: "flat", feePercent: "", feeFlat: "15000" }).success).toBe(true);
  });

  it("keeps the start on or after the offer", () => {
    expect(placementTermsSchema.safeParse({ ...terms, startDate: "2026-10-01" }).success).toBe(false);
  });
});

describe("computeFee", () => {
  it("matches the database rounding", () => {
    expect(computeFee({ feeType: "percentage", baseSalary: 123456.78, feePercent: 22.5 })).toBe(27777.78);
    expect(computeFee({ feeType: "flat", feeFlat: 15000 })).toBe(15000);
  });
});

describe("statusChangeSchema", () => {
  const placementId = crypto.randomUUID();
  it("needs a date, resolution and refund for a refunded fall-off", () => {
    expect(statusChangeSchema.safeParse({ placementId, status: "fell_off", reason: "Left", fellOffOn: "2026-12-20", resolution: "refund" }).success).toBe(false);
    expect(
      statusChangeSchema.safeParse({ placementId, status: "fell_off", reason: "Left", fellOffOn: "2026-12-20", resolution: "refund", refundAmount: "24000" }).success,
    ).toBe(true);
    expect(statusChangeSchema.safeParse({ placementId, status: "started" }).success).toBe(true);
  });
});

describe("invoiceSchema", () => {
  it("requires the credited invoice for credit notes", () => {
    const base = { placementId: crypto.randomUUID(), amount: "100", issueDate: "2026-11-06", dueDate: "2026-12-06", description: "Fee" };
    expect(invoiceSchema.safeParse({ ...base, kind: "credit_note" }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, kind: "invoice", dueDate: "2026-11-01" }).success).toBe(false);
  });
});

describe("usd", () => {
  it("formats numeric strings from Postgres", () => {
    expect(usd("24000.00")).toBe("$24,000.00");
  });
});
