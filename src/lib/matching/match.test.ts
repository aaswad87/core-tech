import { describe, expect, it } from "vitest";

import { compareToJob, findEvidence, type MatchInput } from "./match";

const input: MatchInput = {
  required: ["BGP", "OSPF", "Palo Alto", "C"],
  preferred: ["Python", "C++", ".NET", "bgp"],
  skills: [{ name: "BGP", years_experience: 6 }],
  certifications: [{ name: "PCNSE", issuer: "Palo Alto Networks" }],
  workHistory: [{ title: "Network Engineer", company_name: "Acme", description: "Ran OSPF areas across 12 sites and wrote C++ tooling." }],
  headline: "Routing and security",
  summary: null,
  resumeText: "Automation with Python scripts for config backups. Also built a .NET dashboard.",
};

describe("findEvidence", () => {
  it("cites each place a skill appears", () => {
    expect(findEvidence("BGP", input).evidence).toEqual([{ source: "Skill on record", snippet: "BGP · 6 yrs" }]);
    expect(findEvidence("Palo Alto", input).evidence[0]).toEqual({ source: "Certification", snippet: "PCNSE · Palo Alto Networks" });
    expect(findEvidence("OSPF", input).evidence[0].source).toBe("Work history: Network Engineer at Acme");
    expect(findEvidence("Python", input).evidence[0]).toMatchObject({ source: "Resume" });
  });

  it("matches whole tokens, including symbols", () => {
    expect(findEvidence("C", input).found).toBe(false); // not inside "PCNSE", and C++ is a different language
    expect(findEvidence("C++", input).found).toBe(true);
    expect(findEvidence(".NET", input).found).toBe(true);
  });
});

describe("compareToJob", () => {
  it("lists missing required skills without scoring", () => {
    const r = compareToJob(input);
    expect(r.requiredFound).toBe(3);
    expect(r.missingRequired).toEqual(["C"]);
    expect(r.preferred.map((p) => p.term)).toEqual(["Python", "C++", ".NET", "bgp"]);
    expect(Object.keys(r)).not.toContain("score");
  });
});
