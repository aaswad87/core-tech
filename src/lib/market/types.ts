export const MARKET_SOURCES = ["adzuna", "jsearch", "greenhouse", "lever"] as const;
export type MarketSource = (typeof MARKET_SOURCES)[number];

export const SOURCE_LABELS: Record<MarketSource, string> = {
  adzuna: "Adzuna",
  jsearch: "JSearch (Indeed, Dice, LinkedIn, company sites via Google for Jobs)",
  greenhouse: "Greenhouse career sites",
  lever: "Lever career sites",
};

export const SOURCE_SHORT_LABELS: Record<MarketSource, string> = {
  adzuna: "Adzuna",
  jsearch: "JSearch",
  greenhouse: "Greenhouse",
  lever: "Lever",
};

/** A job posting from any source, already sanitized (plain text, https URL, length-capped). */
export type NormalizedPosting = {
  source: MarketSource;
  externalId: string;
  title: string;
  companyName: string | null;
  location: string | null;
  isRemote: boolean;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string | null;
  url: string;
  postedAt: string | null;
  /** Which job board the aggregator found it on (e.g. "Indeed", "Dice"), when known. */
  publisher?: string | null;
};

export type Hunt = {
  id: string;
  name: string;
  keywords: string[];
  excludeKeywords: string[];
  locations: string[];
  includeRemote: boolean;
  sources: MarketSource[];
  minScore: number;
};

export type WatchCompany = {
  id: string;
  companyName: string;
  source: "greenhouse" | "lever";
  boardToken: string;
};
