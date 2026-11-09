import { describe, expect, it } from "vitest";

import { myProfileSchema, preferencesSchema, privacyRequestSchema, profileChecklist, resolvePrivacySchema } from "./portal";

describe("myProfileSchema", () => {
  it("accepts the editable fields and trims blanks to undefined", () => {
    const parsed = myProfileSchema.parse({ firstName: " Alex ", lastName: "Rivera", phone: "", location: "Dallas, TX", headline: "", summary: "" });
    expect(parsed).toEqual({ firstName: "Alex", lastName: "Rivera", location: "Dallas, TX" });
  });

  it("requires a name and a valid phone number", () => {
    const result = myProfileSchema.safeParse({ firstName: "", lastName: "Rivera", phone: "call me" });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["firstName", "phone"]));
  });

  it("ignores recruiter-only fields", () => {
    const parsed = myProfileSchema.parse({ firstName: "A", lastName: "B", tags: "hired", ownerId: crypto.randomUUID(), source: "x" });
    expect(parsed).not.toHaveProperty("tags");
    expect(parsed).not.toHaveProperty("ownerId");
    expect(parsed).not.toHaveProperty("source");
  });
});

describe("preferencesSchema", () => {
  it("reads checkboxes and an optional arrangement", () => {
    const parsed = preferencesSchema.parse({ openToOpportunities: "on", workArrangement: "", emailJobAlerts: "", desiredTitles: " NOC " });
    expect(parsed).toMatchObject({ openToOpportunities: true, emailJobAlerts: false, workArrangement: undefined, desiredTitles: "NOC" });
  });

  it("rejects unknown arrangements", () => {
    expect(preferencesSchema.safeParse({ workArrangement: "moon" }).success).toBe(false);
  });
});

describe("privacy requests", () => {
  it("requires a known request type", () => {
    expect(privacyRequestSchema.safeParse({ kind: "deletion" }).success).toBe(true);
    expect(privacyRequestSchema.safeParse({ kind: "everything" }).success).toBe(false);
  });

  it("requires a note when declining", () => {
    const requestId = crypto.randomUUID();
    expect(resolvePrivacySchema.safeParse({ requestId, status: "declined", note: " " }).success).toBe(false);
    expect(resolvePrivacySchema.safeParse({ requestId, status: "declined", note: "Not our data" }).success).toBe(true);
    expect(resolvePrivacySchema.safeParse({ requestId, status: "open" }).success).toBe(false);
  });
});

describe("profileChecklist", () => {
  it("counts filled items", () => {
    const list = profileChecklist({ hasName: true, phone: "1", location: null, headline: "", summary: null, resumeCount: 1, hasPreferences: false });
    expect(list.filter((i) => i.done).map((i) => i.label)).toEqual(["Your name", "Phone number", "Resume"]);
  });
});
