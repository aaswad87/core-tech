import { describe, expect, it } from "vitest";

import { feedbackSchema, interviewRequestSchema, jobRequestSchema, zonedLocalToIso } from "./validation";

const companyId = crypto.randomUUID();
const submissionId = crypto.randomUUID();

describe("zonedLocalToIso", () => {
  it("reads wall-clock time in the given zone, across DST", () => {
    expect(zonedLocalToIso("2026-07-01T09:00", "America/Chicago")).toBe("2026-07-01T14:00:00.000Z"); // CDT
    expect(zonedLocalToIso("2026-12-01T09:00", "America/Chicago")).toBe("2026-12-01T15:00:00.000Z"); // CST
    expect(zonedLocalToIso("2026-12-01T09:00", "America/Phoenix")).toBe("2026-12-01T16:00:00.000Z");
  });

  it("rejects malformed input", () => {
    expect(zonedLocalToIso("tomorrow", "America/Chicago")).toBeNull();
  });
});

describe("jobRequestSchema", () => {
  const base = { companyId, title: "Fiber Splicer", employmentType: "direct_hire", openings: "2", description: "Splice OSP fiber" };

  it("accepts a minimal request and parses numbers", () => {
    const parsed = jobRequestSchema.parse({ ...base, salaryMin: "$60,000", salaryMax: "80000", workArrangement: "" });
    expect(parsed).toMatchObject({ openings: 2, salaryMin: 60000, salaryMax: 80000, workArrangement: undefined });
  });

  it("checks the salary range and openings", () => {
    expect(jobRequestSchema.safeParse({ ...base, salaryMin: "90000", salaryMax: "10000" }).success).toBe(false);
    expect(jobRequestSchema.safeParse({ ...base, openings: "0" }).success).toBe(false);
  });
});

describe("interviewRequestSchema", () => {
  const base = { submissionId, format: "video", durationMinutes: "60", timezone: "America/Chicago" };

  it("converts proposed local times to UTC and skips blanks", () => {
    const parsed = interviewRequestSchema.parse({ ...base, slot1: "2099-01-05T10:00", slot2: "", slot3: "2099-01-06T15:30" });
    expect(parsed.proposedTimes).toEqual(["2099-01-05T16:00:00.000Z", "2099-01-06T21:30:00.000Z"]);
  });

  it("rejects past times and unknown zones", () => {
    expect(interviewRequestSchema.safeParse({ ...base, slot1: "2020-01-05T10:00" }).success).toBe(false);
    expect(interviewRequestSchema.safeParse({ ...base, timezone: "Mars/Base", slot1: "2099-01-05T10:00" }).success).toBe(false);
  });
});

describe("feedbackSchema", () => {
  it("makes the rating optional but bounded", () => {
    expect(feedbackSchema.parse({ submissionId, rating: "", body: "Solid" }).rating).toBeUndefined();
    expect(feedbackSchema.safeParse({ submissionId, rating: "7", body: "x" }).success).toBe(false);
  });
});
