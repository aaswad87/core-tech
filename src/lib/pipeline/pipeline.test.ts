import { describe, expect, it } from "vitest";

import { jobFormSchema, toJobColumns } from "@/lib/jobs/validation";
import { daysSince, defaultDisplayName, isClosedStage, STAGES, stageLabel, stageRequiresReason } from "@/lib/pipeline/stages";
import { toFieldErrors } from "@/lib/validation/auth";

describe("pipeline stages", () => {
  it("lists all 12 stages from the plan", () => {
    expect(STAGES.map((s) => s.label)).toEqual([
      "New", "Screening", "Recruiter Interview", "Technical Evaluation", "Submitted to Client", "Client Interview",
      "Offer", "On Hold", "Placed / Hired", "Rejected", "Withdrawn", "Future Opportunity",
    ]);
  });

  it("matches the database's reason rules and closed stages", () => {
    expect(STAGES.filter((s) => stageRequiresReason(s.value)).map((s) => s.value)).toEqual(["on_hold", "rejected", "withdrawn", "future_opportunity"]);
    expect(STAGES.filter((s) => isClosedStage(s.value)).map((s) => s.value)).toEqual(["placed", "rejected", "withdrawn", "future_opportunity"]);
    expect(stageLabel("unknown")).toBe("unknown");
  });

  it("builds the employer-facing display name and day counts", () => {
    expect(defaultDisplayName("Jordan", "rivera")).toBe("Jordan R.");
    expect(defaultDisplayName("Jordan", "-")).toBe("Jordan");
    expect(daysSince("2026-10-20T00:00:00Z", new Date("2026-10-30T12:00:00Z"))).toBe(10);
  });
});

describe("job form", () => {
  const base = { title: "Network Engineer", companyId: crypto.randomUUID(), status: "draft", employmentType: "direct_hire" };

  it("parses skills and salary", () => {
    const job = jobFormSchema.parse({ ...base, requiredSkills: "BGP, OSPF\nbgp", salaryMin: "$120,000", salaryMax: "150000" });
    expect(toJobColumns(job)).toMatchObject({ required_skills: ["BGP", "OSPF"], salary_min: 120000, salary_max: 150000, preferred_skills: [] });
  });

  it("requires a company, a sane salary range, and a public summary to publish", () => {
    const result = jobFormSchema.safeParse({ ...base, companyId: "", status: "published", salaryMin: "200000", salaryMax: "100000" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(toFieldErrors(result.error)).sort()).toEqual(["companyId", "publicSummary", "salaryMax"]);
    expect(jobFormSchema.safeParse({ ...base, companyId: "", newCompanyName: "New Co" }).success).toBe(true);
    expect(jobFormSchema.safeParse({ ...base, status: "published", publicSummary: "Design BGP networks." }).success).toBe(true);
  });

  it("rejects unknown statuses and employment types", () => {
    expect(jobFormSchema.safeParse({ ...base, status: "live" }).success).toBe(false);
    expect(jobFormSchema.safeParse({ ...base, employmentType: "gig" }).success).toBe(false);
  });
});
