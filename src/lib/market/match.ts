import type { Hunt, NormalizedPosting } from "@/lib/market/types";

/**
 * Explainable fit scoring. Every point comes from a visible rule:
 *   - keyword in the job title: +3
 *   - keyword only in the description: +1
 * A posting matches when it has at least one keyword hit, reaches the hunt's minimum score,
 * passes the location rule, and contains no excluded keyword.
 */
export const TITLE_POINTS = 3;
export const DESCRIPTION_POINTS = 1;

export type FitResult = {
  matches: boolean;
  score: number;
  matchedTerms: string[];
  /** Why a posting was rejected, for debugging and tests. */
  reason?: "excluded" | "location" | "no_keywords" | "below_threshold";
};

const US_STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct",
  delaware: "de", florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi",
  minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc",
  "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
  "district of columbia": "dc",
};
const STATE_NAMES = Object.fromEntries(Object.entries(US_STATES).map(([name, abbr]) => [abbr, name]));

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word/phrase match that also works for terms like "C++" or ".NET". */
export function containsTerm(haystack: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}($|[^a-z0-9])`, "i").test(haystack);
}

/** "Texas" matches "Dallas, TX"; "TX" matches "Austin, Texas"; cities match by substring. */
export function locationMatches(postingLocation: string | null, wanted: string): boolean {
  if (!postingLocation) return false;
  const loc = normalize(postingLocation);
  const w = normalize(wanted);
  if (!w) return false;
  if (containsTerm(loc, w)) return true;
  // Abbreviations like "in", "or", "me" are also ordinary words, so only accept them after a comma
  // ("Dallas, TX") or as the whole location.
  const abbr = US_STATES[w];
  if (abbr && (loc === abbr || new RegExp(`,\\s*${abbr}($|[^a-z])`).test(loc))) return true;
  const fullName = STATE_NAMES[w];
  if (fullName && containsTerm(loc, fullName)) return true;
  return false;
}

export function scorePosting(hunt: Pick<Hunt, "keywords" | "excludeKeywords" | "locations" | "includeRemote" | "minScore">, posting: NormalizedPosting): FitResult {
  const title = normalize(posting.title);
  const body = normalize(posting.description ?? "");

  if (hunt.excludeKeywords.some((term) => containsTerm(title, term) || containsTerm(body, term))) {
    return { matches: false, score: 0, matchedTerms: [], reason: "excluded" };
  }

  if (hunt.locations.length > 0) {
    const remoteOk = hunt.includeRemote && posting.isRemote;
    if (!remoteOk && !hunt.locations.some((l) => locationMatches(posting.location, l))) {
      return { matches: false, score: 0, matchedTerms: [], reason: "location" };
    }
  }

  let score = 0;
  const matchedTerms: string[] = [];
  for (const term of hunt.keywords) {
    if (containsTerm(title, term)) {
      score += TITLE_POINTS;
      matchedTerms.push(term);
    } else if (containsTerm(body, term)) {
      score += DESCRIPTION_POINTS;
      matchedTerms.push(term);
    }
  }

  if (matchedTerms.length === 0) return { matches: false, score: 0, matchedTerms, reason: "no_keywords" };
  if (score < hunt.minScore) return { matches: false, score, matchedTerms, reason: "below_threshold" };
  return { matches: true, score, matchedTerms };
}
