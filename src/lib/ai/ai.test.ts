import { describe, expect, it, vi } from "vitest";

import { parseAiConfig } from "./config";
import { proposeWithOpenAI } from "./openai";
import { checkProposal, evidenceFound, PROPOSAL_JSON_SCHEMA, preselect } from "./proposal";
import { normalizeResumeText, redactContactDetails } from "./redact";

describe("parseAiConfig", () => {
  it("stays off until the privacy review flag and credentials are set", () => {
    const off = parseAiConfig({ OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "model-x" });
    expect(off).toEqual({ enabled: false, missing: ["Privacy and security review (AI_PRIVACY_REVIEW_APPROVED=true)"] });
    expect(parseAiConfig({ AI_PRIVACY_REVIEW_APPROVED: "true" })).toMatchObject({ enabled: false, missing: ["OPENAI_API_KEY", "OPENAI_MODEL"] });
    expect(parseAiConfig({ AI_PRIVACY_REVIEW_APPROVED: "true", OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "model-x", AI_MONTHLY_TOKEN_BUDGET: "500000" })).toMatchObject({
      enabled: true,
      hourlyLimit: 10,
      monthlyLimit: 200,
      monthlyTokenBudget: 500000,
    });
  });

  it("rejects bad limits", () => {
    expect(() => parseAiConfig({ AI_HOURLY_LIMIT: "0" })).toThrow(/AI_HOURLY_LIMIT/);
    expect(() => parseAiConfig({ OPENAI_MODEL: "bad model; drop" })).toThrow(/OPENAI_MODEL/);
  });
});

describe("redactContactDetails", () => {
  it("removes emails, phones, links and street addresses but keeps job content", () => {
    const { text, redactions } = redactContactDetails(
      "Jordan Lee\njordan.lee@example.com | (214) 555-0100 | linkedin.com/in/jlee | https://jlee.dev\n4500 Elm Street Apt 2, Dallas, TX\nSenior Network Engineer, 2019-Present. Configured BGP on 40 routers.",
    );
    expect(text).not.toMatch(/example\.com|555-0100|linkedin|jlee\.dev|4500 Elm/);
    expect(text).toContain("Configured BGP on 40 routers.");
    expect(text).toContain("Dallas, TX");
    expect(redactions).toBe(5);
  });
});

describe("normalizeResumeText", () => {
  it("collapses whitespace", () => {
    expect(normalizeResumeText("A\t\tB\r\n\r\n\r\n\r\nC   D")).toBe("A B\n\nC D");
  });
});

const source = "Senior Network Engineer at Acme Telecom, Jan 2019 – Present. Configured BGP and OSPF across 40 sites. CCNP Enterprise (Cisco).";

const goodJson = {
  headline: { value: "Senior Network Engineer", evidence: "Senior Network Engineer", confidence: "high" },
  summary: { value: "Network engineer focused on routing.", confidence: "medium" },
  location: { value: null, evidence: null, confidence: "low" },
  skills: [
    { name: "BGP", years_experience: null, evidence: "Configured BGP and OSPF across 40 sites", confidence: "high" },
    { name: "bgp", years_experience: null, evidence: "BGP", confidence: "high" },
    { name: "Kubernetes", years_experience: 3, evidence: "Ran Kubernetes clusters", confidence: "low" },
  ],
  certifications: [{ name: "CCNP Enterprise", issuer: "Cisco", evidence: "CCNP Enterprise (Cisco)", confidence: "high" }],
  work_history: [
    {
      company: "Acme Telecom",
      title: "Senior Network Engineer",
      location: null,
      start_month: "2019-01",
      end_month: null,
      is_current: true,
      description: null,
      evidence: "Senior Network Engineer at Acme Telecom, Jan 2019 - Present",
      confidence: "high",
    },
  ],
  uncertainties: [],
};

describe("checkProposal", () => {
  it("verifies evidence quotes against the source and drops duplicate skills", () => {
    const r = checkProposal(goodJson, source);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.skills.map((s) => s.name)).toEqual(["BGP", "Kubernetes"]);
    expect(r.proposal.verified.skills).toEqual([true, false]); // Kubernetes quote isn't in the resume
    expect(r.proposal.verified.work_history).toEqual([true]); // en dash vs hyphen tolerated
    expect(r.proposal.verified.certifications).toEqual([true]);
  });

  it("rejects responses with extra or missing fields", () => {
    expect(checkProposal({ ...goodJson, skills: "BGP" }, source).ok).toBe(false);
    expect(checkProposal({ ...goodJson, work_history: [{ ...goodJson.work_history[0], start_month: "2019-13" }] }, source).ok).toBe(false);
  });

  it("strips protected-characteristic keys the model might add", () => {
    const r = checkProposal({ ...goodJson, date_of_birth: "1980-01-01", gender: "x" }, source);
    expect(r.ok && "date_of_birth" in r.proposal).toBe(false);
  });
});

describe("evidenceFound / preselect", () => {
  it("needs a real quote", () => {
    expect(evidenceFound(source, "  configured bgp  ")).toBe(true);
    expect(evidenceFound(source, "BG")).toBe(false);
    expect(evidenceFound(source, null)).toBe(false);
  });
  it("preselects verified, non-low items only", () => {
    expect(preselect(true, "medium")).toBe(true);
    expect(preselect(true, "low")).toBe(false);
    expect(preselect(false, "high")).toBe(false);
  });
});

describe("PROPOSAL_JSON_SCHEMA", () => {
  it("is strict: every object lists all keys as required with no extras", () => {
    const walk = (node: Record<string, unknown>) => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
        Object.values(node.properties as Record<string, Record<string, unknown>>).forEach(walk);
      }
      if (node.type === "array") walk(node.items as Record<string, unknown>);
    };
    walk(PROPOSAL_JSON_SCHEMA as Record<string, unknown>);
  });
});

describe("proposeWithOpenAI", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("returns parsed JSON and token usage, without storing at the provider", async () => {
    const fetchImpl = ok({ choices: [{ message: { content: JSON.stringify(goodJson) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 400 } });
    const r = await proposeWithOpenAI(fetchImpl as unknown as typeof fetch, { apiKey: "sk", model: "m", resumeText: "text" });
    expect(r).toMatchObject({ ok: true, inputTokens: 900, outputTokens: 400 });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.store).toBe(false);
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("turns provider failures into safe messages", async () => {
    expect((await proposeWithOpenAI(ok({ error: { message: "bad key" } }, 401) as unknown as typeof fetch, { apiKey: "sk", model: "m", resumeText: "t" })).ok).toBe(false);
    const cut = await proposeWithOpenAI(ok({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }) as unknown as typeof fetch, { apiKey: "sk", model: "m", resumeText: "t" });
    expect(cut).toMatchObject({ ok: false, error: expect.stringMatching(/cut off/) });
    const refused = await proposeWithOpenAI(ok({ choices: [{ message: { content: null, refusal: "no" } }] }) as unknown as typeof fetch, { apiKey: "sk", model: "m", resumeText: "t" });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/declined/) });
    const down = await proposeWithOpenAI((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch, { apiKey: "sk", model: "m", resumeText: "t" });
    expect(down).toMatchObject({ ok: false, error: "Couldn't reach the AI provider." });
  });
});
