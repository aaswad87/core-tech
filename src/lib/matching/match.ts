/**
 * Evidence-based comparison of a candidate's record with a job's skills. Deterministic (no AI): for each
 * required and preferred skill it lists where the record mentions it, or that it wasn't found. It never
 * scores, ranks or recommends — a recruiter reads the evidence and decides.
 */
export type MatchSource =
  | { kind: "skill"; label: string }
  | { kind: "certification"; label: string }
  | { kind: "work"; label: string; text: string }
  | { kind: "profile"; label: string; text: string }
  | { kind: "resume"; label: string; text: string };

export type Evidence = { source: string; snippet: string };
export type TermResult = { term: string; found: boolean; evidence: Evidence[] };

export type MatchInput = {
  required: string[];
  preferred: string[];
  skills: { name: string; years_experience: number | null }[];
  certifications: { name: string; issuer: string | null }[];
  workHistory: { title: string; company_name: string; description: string | null }[];
  headline: string | null;
  summary: string | null;
  resumeText: string | null;
};

const MAX_EVIDENCE_PER_TERM = 4;
const SNIPPET_RADIUS = 70;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches the term as a whole token: "C" matches neither "CCNP" nor "C++"/"C#", while "C++" and ".NET" work. */
function termPattern(term: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escape(term.trim())}(?![A-Za-z0-9+#])`, "i");
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function sources(input: MatchInput): MatchSource[] {
  const out: MatchSource[] = [];
  for (const s of input.skills) out.push({ kind: "skill", label: s.years_experience != null ? `${s.name} · ${s.years_experience} yrs` : s.name });
  for (const c of input.certifications) out.push({ kind: "certification", label: [c.name, c.issuer].filter(Boolean).join(" · ") });
  for (const w of input.workHistory) {
    out.push({ kind: "work", label: `${w.title} at ${w.company_name}`, text: [w.title, w.description].filter(Boolean).join("\n") });
  }
  const profile = [input.headline, input.summary].filter(Boolean).join("\n");
  if (profile) out.push({ kind: "profile", label: "Headline / summary", text: profile });
  if (input.resumeText) out.push({ kind: "resume", label: "Resume", text: input.resumeText });
  return out;
}

const SOURCE_NAME: Record<MatchSource["kind"], string> = {
  skill: "Skill on record",
  certification: "Certification",
  work: "Work history",
  profile: "Profile",
  resume: "Resume",
};

export function findEvidence(term: string, input: MatchInput): TermResult {
  const pattern = termPattern(term);
  const evidence: Evidence[] = [];
  for (const src of sources(input)) {
    if (evidence.length >= MAX_EVIDENCE_PER_TERM) break;
    if (src.kind === "skill" || src.kind === "certification") {
      if (pattern.test(src.label)) evidence.push({ source: SOURCE_NAME[src.kind], snippet: src.label });
      continue;
    }
    const m = pattern.exec(src.text);
    if (m) evidence.push({ source: src.kind === "work" ? `${SOURCE_NAME.work}: ${src.label}` : SOURCE_NAME[src.kind], snippet: snippetAround(src.text, m.index, m[0].length) });
  }
  return { term, found: evidence.length > 0, evidence };
}

export function compareToJob(input: MatchInput) {
  const unique = (terms: string[]) => [...new Map(terms.filter((t) => t.trim().length >= 1).map((t) => [t.trim().toLowerCase(), t.trim()])).values()];
  const required = unique(input.required).map((t) => findEvidence(t, input));
  const preferred = unique(input.preferred).map((t) => findEvidence(t, input));
  return {
    required,
    preferred,
    requiredFound: required.filter((r) => r.found).length,
    preferredFound: preferred.filter((r) => r.found).length,
    missingRequired: required.filter((r) => !r.found).map((r) => r.term),
  };
}
