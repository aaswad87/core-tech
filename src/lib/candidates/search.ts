import { z } from "zod";

export const CANDIDATES_PAGE_SIZE = 25;

export type CandidateSearch = {
  query: string;
  /** "any", "me", "unowned", or a staff user id. */
  owner: string;
  tag: string;
  skill: string;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

/** Normalizes untrusted search params. */
export function parseCandidateSearch(params: Params): CandidateSearch {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const ownerRaw = first(params.owner);
  const owner =
    ownerRaw === "me" || ownerRaw === "unowned" || z.uuid().safeParse(ownerRaw).success ? ownerRaw : "any";
  const page = Number.parseInt(first(params.page) || "1", 10);
  return {
    query: first(params.q).trim().slice(0, 100),
    owner,
    tag: first(params.tag).trim().toLowerCase().slice(0, 40),
    skill: first(params.skill).trim().slice(0, 80),
    page: Number.isFinite(page) ? Math.min(Math.max(page, 1), 4000) : 1,
  };
}

/** Arguments for public.search_candidates. */
export function toSearchRpcArgs(search: CandidateSearch, currentUserId: string) {
  return {
    p_query: search.query || null,
    p_owner_id: search.owner === "me" ? currentUserId : search.owner === "any" || search.owner === "unowned" ? null : search.owner,
    p_unowned: search.owner === "unowned",
    p_tag: search.tag || null,
    p_skill: search.skill || null,
    p_limit: CANDIDATES_PAGE_SIZE,
    p_offset: (search.page - 1) * CANDIDATES_PAGE_SIZE,
  };
}

export function candidatesHref(search: CandidateSearch, overrides: Partial<CandidateSearch> = {}): string {
  const next = { ...search, ...overrides };
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.owner !== "any") params.set("owner", next.owner);
  if (next.tag) params.set("tag", next.tag);
  if (next.skill) params.set("skill", next.skill);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `/recruiter/candidates?${qs}` : "/recruiter/candidates";
}
