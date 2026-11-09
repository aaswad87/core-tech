import { describe, expect, it } from "vitest";

import { toFieldErrors } from "@/lib/validation/auth";
import { leadSchema, toLeadRow } from "@/lib/validation/leads";

const base = {
  fullName: "  Jordan Demo ",
  email: "Jordan@Example.TEST",
  phone: "",
  consent: "on",
  website: "",
  sourcePath: "/contact",
};

describe("leadSchema", () => {
  it("accepts a contact lead and normalizes fields", () => {
    const lead = leadSchema.parse({ ...base, type: "contact", topic: "general", message: "Hello, I have a question." });
    expect(lead.fullName).toBe("Jordan Demo");
    expect(lead.email).toBe("jordan@example.test");
    expect(lead.phone).toBeUndefined();
  });

  it("requires consent", () => {
    const result = leadSchema.safeParse({ ...base, consent: undefined, type: "contact", topic: "general", message: "Hello there friend" });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error).consent).toMatch(/privacy policy/);
  });

  it("rejects a filled honeypot", () => {
    const result = leadSchema.safeParse({ ...base, website: "http://spam.test", type: "contact", topic: "general", message: "Buy now buy now" });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error).website).toBeDefined();
  });

  it("rejects unknown topics, specialties and lead types", () => {
    expect(leadSchema.safeParse({ ...base, type: "contact", topic: "hack", message: "Hello there friend" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, type: "candidate", specialty: "astrology" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, type: "admin" }).success).toBe(false);
  });

  it("requires company and role for employer requests and coerces openings", () => {
    const missing = leadSchema.safeParse({ ...base, type: "employer" });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      const errors = toFieldErrors(missing.error);
      expect(errors.companyName).toBeDefined();
      expect(errors.roleTitle).toBeDefined();
    }

    const ok = leadSchema.parse({
      ...base,
      type: "employer",
      companyName: "Demo Co",
      roleTitle: "Network Engineer",
      positionsCount: "3",
      timeline: "",
    });
    expect(ok.type === "employer" && ok.positionsCount).toBe(3);
    expect(ok.type === "employer" && ok.timeline).toBeUndefined();
  });

  it("rejects out-of-range openings and invalid phone numbers", () => {
    const employer = { ...base, type: "employer", companyName: "Demo", roleTitle: "Role" };
    expect(leadSchema.safeParse({ ...employer, positionsCount: "0" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...employer, positionsCount: "2.5" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...employer, phone: "call me" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...employer, phone: "+1 (512) 555-0100" }).success).toBe(true);
  });

  it("rejects a source path that is not a site path", () => {
    expect(
      leadSchema.safeParse({ ...base, sourcePath: "https://evil.test", type: "contact", topic: "general", message: "Hello there friend" })
        .success,
    ).toBe(false);
  });

  it("accepts only UUID job references", () => {
    const candidate = { ...base, type: "candidate", specialty: "networking" };
    expect(leadSchema.safeParse({ ...candidate, jobId: "not-a-uuid" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...candidate, jobId: crypto.randomUUID() }).success).toBe(true);
  });
});

describe("toLeadRow", () => {
  it("only maps fields that belong to the lead type", () => {
    const row = toLeadRow(
      leadSchema.parse({
        ...base,
        type: "candidate",
        specialty: "cloud",
        location: "Austin, TX",
        // Fields from other forms are ignored even if submitted.
        companyName: "Injected",
        topic: "general",
      }),
    );
    expect(row).toMatchObject({ type: "candidate", specialty: "cloud", location: "Austin, TX", company_name: null, topic: null });
  });
});
