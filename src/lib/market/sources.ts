import { cleanText, htmlToText, safeHttpsUrl, toIsoDate, toMoney } from "@/lib/market/text";
import type { MarketSource, NormalizedPosting } from "@/lib/market/types";

/**
 * Connectors for external job sources. Each has a request builder and a parser that accepts unknown
 * JSON and returns only well-formed, sanitized postings (malformed records are skipped, not thrown).
 *
 *  - Adzuna:     https://developer.adzuna.com  (app_id + app_key)
 *  - JSearch:    RapidAPI "JSearch" by OpenWeb Ninja — Google for Jobs data, which includes Indeed,
 *                Dice, LinkedIn and employers' own career sites (RapidAPI key)
 *  - Greenhouse: public Job Board API, no key (boards-api.greenhouse.io/v1/boards/{token}/jobs)
 *  - Lever:      public Postings API, no key (api.lever.co/v0/postings/{site})
 */

export type SourceRequest = { url: string; headers?: Record<string, string> };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);

const REMOTE_PATTERN = /\b(remote|work from home|wfh|anywhere)\b/i;

function finalize(p: Omit<NormalizedPosting, "url" | "externalId" | "title"> & { url: unknown; externalId: unknown; title: unknown }) {
  const url = safeHttpsUrl(p.url);
  const externalId = cleanText(p.externalId, 200);
  const title = cleanText(p.title, 300);
  if (!url || !externalId || !title) return null;
  const isRemote = p.isRemote || REMOTE_PATTERN.test(`${title} ${p.location ?? ""}`);
  return { ...p, url, externalId, title, isRemote } satisfies NormalizedPosting;
}

function compact(postings: (NormalizedPosting | null)[]): NormalizedPosting[] {
  return postings.filter((p): p is NormalizedPosting => p !== null);
}

// --- Adzuna -----------------------------------------------------------------

export function adzunaRequest(opts: { appId: string; appKey: string; what: string; where?: string; maxDaysOld?: number }): SourceRequest {
  const params = new URLSearchParams({
    app_id: opts.appId,
    app_key: opts.appKey,
    what: opts.what,
    results_per_page: "50",
    max_days_old: String(opts.maxDaysOld ?? 3),
    sort_by: "date",
    "content-type": "application/json",
  });
  if (opts.where) params.set("where", opts.where);
  return { url: `https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}` };
}

export function parseAdzuna(json: unknown): NormalizedPosting[] {
  const results = isObject(json) && Array.isArray(json.results) ? json.results : [];
  return compact(
    results.filter(isObject).map((r) =>
      finalize({
        source: "adzuna",
        externalId: str(r.id),
        title: r.title,
        companyName: cleanText(isObject(r.company) ? r.company.display_name : null, 200),
        location: cleanText(isObject(r.location) ? r.location.display_name : null, 200),
        isRemote: false,
        employmentType: cleanText([r.contract_time, r.contract_type].filter(Boolean).join(" "), 50),
        salaryMin: toMoney(r.salary_min),
        salaryMax: toMoney(r.salary_max),
        description: htmlToText(str(r.description)),
        url: r.redirect_url,
        postedAt: toIsoDate(r.created),
        publisher: "Adzuna",
      }),
    ),
  );
}

// --- JSearch (Google for Jobs) ------------------------------------------------

export function jsearchRequest(opts: { apiKey: string; query: string; datePosted?: "today" | "3days" | "week" }): SourceRequest {
  const params = new URLSearchParams({
    query: opts.query,
    page: "1",
    num_pages: "1",
    country: "us",
    date_posted: opts.datePosted ?? "3days",
  });
  return {
    url: `https://jsearch.p.rapidapi.com/search?${params.toString()}`,
    headers: { "x-rapidapi-key": opts.apiKey, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
  };
}

export function parseJSearch(json: unknown): NormalizedPosting[] {
  const data = isObject(json) && Array.isArray(json.data) ? json.data : [];
  return compact(
    data.filter(isObject).map((j) => {
      const location =
        cleanText(j.job_location, 200) ??
        cleanText([j.job_city, j.job_state, j.job_country].filter((v) => typeof v === "string" && v).join(", "), 200);
      return finalize({
        source: "jsearch",
        externalId: str(j.job_id),
        title: j.job_title,
        companyName: cleanText(j.employer_name, 200),
        location,
        isRemote: j.job_is_remote === true,
        employmentType: cleanText(j.job_employment_type, 50),
        salaryMin: toMoney(j.job_min_salary),
        salaryMax: toMoney(j.job_max_salary),
        description: htmlToText(str(j.job_description)),
        url: j.job_apply_link ?? j.job_google_link,
        postedAt: toIsoDate(j.job_posted_at_datetime_utc ?? (typeof j.job_posted_at_timestamp === "number" ? j.job_posted_at_timestamp * 1000 : null)),
        publisher: cleanText(j.job_publisher, 80),
      });
    }),
  );
}

// --- Greenhouse (company career boards) --------------------------------------

export function greenhouseRequest(boardToken: string): SourceRequest {
  return { url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true` };
}

export function parseGreenhouse(json: unknown, companyName: string): NormalizedPosting[] {
  const jobs = isObject(json) && Array.isArray(json.jobs) ? json.jobs : [];
  return compact(
    jobs.filter(isObject).map((j) =>
      finalize({
        source: "greenhouse",
        externalId: str(j.id),
        title: j.title,
        companyName: cleanText(j.company_name, 200) ?? cleanText(companyName, 200),
        location: cleanText(isObject(j.location) ? j.location.name : null, 200),
        isRemote: false,
        employmentType: null,
        salaryMin: null,
        salaryMax: null,
        description: htmlToText(str(j.content)),
        url: j.absolute_url,
        postedAt: toIsoDate(j.first_published ?? j.updated_at),
        publisher: "Company career site",
      }),
    ),
  );
}

// --- Lever (company career boards) --------------------------------------------

export function leverRequest(site: string): SourceRequest {
  return { url: `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json` };
}

export function parseLever(json: unknown, companyName: string): NormalizedPosting[] {
  const postings = Array.isArray(json) ? json : [];
  return compact(
    postings.filter(isObject).map((p) => {
      const categories = isObject(p.categories) ? p.categories : {};
      return finalize({
        source: "lever",
        externalId: str(p.id),
        title: p.text,
        companyName: cleanText(companyName, 200),
        location: cleanText(categories.location, 200),
        isRemote: p.workplaceType === "remote",
        employmentType: cleanText(categories.commitment, 50),
        salaryMin: null,
        salaryMax: null,
        description: htmlToText(str(p.descriptionPlain) ?? str(p.description)),
        url: p.hostedUrl,
        postedAt: toIsoDate(p.createdAt),
        publisher: "Company career site",
      });
    }),
  );
}

export const PARSERS: Record<MarketSource, (json: unknown, companyName: string) => NormalizedPosting[]> = {
  adzuna: (json) => parseAdzuna(json),
  jsearch: (json) => parseJSearch(json),
  greenhouse: parseGreenhouse,
  lever: parseLever,
};

/** GET JSON with a timeout and a response-size cap. Throws a short, secret-free error message. */
export async function fetchJson(fetchImpl: typeof fetch, request: SourceRequest, timeoutMs = 15_000): Promise<unknown> {
  const response = await fetchImpl(request.url, {
    headers: { accept: "application/json", "user-agent": "CoreTechRecruiting-JobRadar/1.0", ...request.headers },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 15_000_000) throw new Error("Response too large");
  return JSON.parse(text);
}
