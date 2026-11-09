import { describe, expect, it } from "vitest";

import { buildInterviewIcs, formatWhen, renderInterviewEmail, type InterviewEmailData } from "./email";

const base: InterviewEmailData = {
  interviewId: "11111111-1111-1111-1111-111111111111",
  candidateFirstName: "Casey",
  jobTitle: "Network Engineer <script>",
  companyName: "Acme & Co",
  format: "video",
  startsAt: "2026-12-01T15:00:00.000Z",
  durationMinutes: 45,
  timezone: "America/Chicago",
  meetingUrl: "https://zoom.example/j/1?a=1&b=2",
  location: null,
  instructions: "Bring questions, please",
  portalUrl: "https://coretech.example/candidate",
  sequence: 0,
};

describe("formatWhen", () => {
  it("shows the time in the interview's time zone", () => {
    expect(formatWhen(base.startsAt, "America/Chicago")).toContain("9:00");
    expect(formatWhen(base.startsAt, "America/Chicago")).toMatch(/CST/);
  });
});

describe("renderInterviewEmail", () => {
  it("escapes everything in the HTML part", () => {
    const { html, subject } = renderInterviewEmail("scheduled", base);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Network Engineer &lt;script&gt;");
    expect(html).toContain("Acme &amp; Co");
    expect(html).toContain('href="https://zoom.example/j/1?a=1&amp;b=2"');
    expect(subject).toBe("Interview scheduled: Network Engineer <script>");
  });

  it("keeps subjects on one line", () => {
    expect(renderInterviewEmail("scheduled", { ...base, jobTitle: "A\r\nBcc: x@y.z" }).subject).toBe("Interview scheduled: A Bcc: x@y.z");
  });

  it("describes reschedules and cancellations", () => {
    const moved = renderInterviewEmail("rescheduled", { ...base, previousStartsAt: "2026-11-30T15:00:00.000Z" });
    expect(moved.text).toContain("Previously:");
    const cancelled = renderInterviewEmail("cancelled", { ...base, reason: "Role on hold" });
    expect(cancelled.text).toContain("Reason: Role on hold");
    expect(cancelled.text).not.toContain("Join link");
  });
});

describe("buildInterviewIcs", () => {
  it("builds a valid single-event calendar", () => {
    const ics = buildInterviewIcs("scheduled", base, new Date("2026-11-05T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261201T150000Z");
    expect(ics).toContain("DTEND:20261201T154500Z");
    expect(ics).toContain(`UID:interview-${base.interviewId}@coretech-recruiting`);
    expect(ics).toContain("SUMMARY:Interview: Network Engineer <script> (Acme & Co)");
    expect(ics.replace(/\r\n /g, "")).toContain("Bring questions\\, please");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });

  it("cancels the same event", () => {
    const ics = buildInterviewIcs("cancelled", { ...base, sequence: 2 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
  });
});
