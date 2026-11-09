import { describe, expect, it } from "vitest";

import { outcomeSchema, rescheduleSchema, scheduleSchema, toZonedLocalInput } from "./validation";

const applicationId = crypto.randomUUID();
const base = {
  applicationId,
  kind: "technical",
  format: "video",
  startsAtLocal: "2099-03-02T10:00",
  durationMinutes: "60",
  timezone: "America/Chicago",
  meetingUrl: "https://meet.example/abc",
  notifyCandidate: "on",
};

describe("scheduleSchema", () => {
  it("converts the local time in the chosen zone", () => {
    const parsed = scheduleSchema.parse(base);
    expect(parsed.startsAt).toBe("2099-03-02T16:00:00.000Z");
    expect(parsed.notifyCandidate).toBe(true);
  });

  it("requires a link for video and an address on-site", () => {
    expect(scheduleSchema.safeParse({ ...base, meetingUrl: "" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, meetingUrl: "http://meet.example" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, format: "onsite", meetingUrl: "", location: "" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, format: "phone", meetingUrl: "" }).success).toBe(true);
  });

  it("rejects past times", () => {
    expect(scheduleSchema.safeParse({ ...base, startsAtLocal: "2020-01-01T10:00" }).success).toBe(false);
  });
});

describe("rescheduleSchema", () => {
  it("needs a reason", () => {
    const r = { interviewId: crypto.randomUUID(), format: "phone", startsAtLocal: "2099-03-02T10:00", durationMinutes: "30", timezone: "America/Chicago" };
    expect(rescheduleSchema.safeParse({ ...r, reason: " " }).success).toBe(false);
    expect(rescheduleSchema.safeParse({ ...r, reason: "Conflict" }).success).toBe(true);
  });
});

describe("outcomeSchema", () => {
  it("blocks an outcome on a no-show", () => {
    const interviewId = crypto.randomUUID();
    expect(outcomeSchema.safeParse({ interviewId, status: "no_show", outcome: "advance" }).success).toBe(false);
    expect(outcomeSchema.safeParse({ interviewId, status: "completed", outcome: "hold" }).success).toBe(true);
  });
});

describe("toZonedLocalInput", () => {
  it("round-trips with the schedule conversion", () => {
    expect(toZonedLocalInput("2099-03-02T16:00:00.000Z", "America/Chicago")).toBe("2099-03-02T10:00");
  });
});
