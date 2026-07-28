import * as cheerio from "cheerio";
import type { JobListingInput, UserProfile } from "@jobfinder/shared";
import type { LinkedInFetchResult } from "./linkedinTypes.js";
import {
  getMaxPostedDays,
  getSearchLocation,
  getSearchQuery,
} from "./utils.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GUEST_SEARCH_BASE =
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";

function linkedInTimeFilter(maxDays: number): string {
  if (maxDays <= 1) return "r86400";
  if (maxDays <= 7) return "r604800";
  if (maxDays <= 30) return "r2592000";
  return "";
}

function buildGuestEasyApplyUrl(profile: UserProfile, start: number): string {
  const params = new URLSearchParams({
    keywords: getSearchQuery(profile),
    location: getSearchLocation(profile),
    f_AL: "true",
    start: String(start),
    count: "25",
  });
  const timeFilter = linkedInTimeFilter(getMaxPostedDays(profile));
  if (timeFilter) params.set("f_TPR", timeFilter);
  return `${GUEST_SEARCH_BASE}?${params.toString()}`;
}

function parseJobIdFromUrl(href: string): string {
  const m = href.match(/jobs\/view\/[^/]*-(\d+)/) ?? href.match(/jobs\/view\/(\d+)/);
  return m?.[1] ?? href.split("/").pop()?.replace(/\D/g, "") ?? href;
}

function normalizeJobUrl(href: string): string {
  try {
    const u = new URL(href, "https://www.linkedin.com");
    const path = u.pathname.replace(/\/$/, "");
    const id = path.match(/(\d{8,})$/)?.[1];
    if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    return `https://www.linkedin.com${path}/`;
  } catch {
    return href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
  }
}

function detectEasyApplyOnGuestCard(card: ReturnType<cheerio.CheerioAPI>): boolean {
  const text = card.text().toLowerCase();
  if (/\beasy\s*apply\b/.test(text) || /\bapply\s+with\s+linkedin\b/.test(text)) {
    return true;
  }
  if (
    /apply\s+on\s+company|company\s+website|off-?site|you will be redirected/i.test(text)
  ) {
    return false;
  }
  // f_AL=true guest search — LinkedIn already filtered to Easy Apply
  return true;
}

function parseGuestSearchHtml(html: string): JobListingInput[] {
  const $ = cheerio.load(html);
  const listings: JobListingInput[] = [];
  const seen = new Set<string>();

  const cards = $(".job-search-card, [data-entity-urn*='jobPosting']").toArray();
  for (const el of cards) {
    const card = $(el);
    const title = card.find(".base-search-card__title").first().text().trim();
    if (!title) continue;

    const link = card.find("a[href*='/jobs/view']").first().attr("href");
    if (!link) continue;

    const url = normalizeJobUrl(link);
    if (seen.has(url)) continue;
    seen.add(url);

    if (!detectEasyApplyOnGuestCard(card)) continue;

    const company =
      card.find(".base-search-card__subtitle").first().text().trim() ||
      card.find("h4 a").first().text().trim() ||
      "Unknown";
    const location =
      card.find(".job-search-card__location").first().text().trim() || "Ireland";
    const dateText = card.find("time").first().text().trim();

    listings.push({
      externalId: parseJobIdFromUrl(url),
      source: "linkedin",
      title,
      company,
      location,
      url,
      description: "",
      tags: [],
      postedAt: parseGuestDate(dateText)?.toISOString(),
      linkedInApplyType: "easy_apply",
    });
  }

  return listings;
}

function parseGuestDate(text: string): Date | undefined {
  const t = text.toLowerCase();
  const now = new Date();
  if (!t) return undefined;
  if (t.includes("hour") || t.includes("minute")) return now;
  if (t.includes("day")) {
    const m = t.match(/(\d+)/);
    if (m) {
      now.setDate(now.getDate() - Number(m[1]));
      return now;
    }
  }
  if (t.includes("week")) {
    const m = t.match(/(\d+)/);
    if (m) {
      now.setDate(now.getDate() - Number(m[1]) * 7);
      return now;
    }
  }
  return undefined;
}

/**
 * LinkedIn's public pagination API with f_AL=true — purpose-built Easy Apply filter.
 * Much faster and more reliable than scraping the logged-in search UI.
 */
export async function fetchGuestEasyApplyJobs(profile: UserProfile): Promise<LinkedInFetchResult> {
  const listings: JobListingInput[] = [];
  const seen = new Set<string>();

  try {
    for (const start of [0, 25]) {
      const url = buildGuestEasyApplyUrl(profile, start);
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn(`[linkedin-guest] HTTP ${res.status} for ${getSearchQuery(profile)}`);
        break;
      }

      const html = await res.text();
      if (html.length < 200 || !/job-search-card|jobPosting/i.test(html)) {
        break;
      }

      for (const job of parseGuestSearchHtml(html)) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        listings.push(job);
      }

      if (!html.includes("data-entity-urn") || parseGuestSearchHtml(html).length < 20) {
        break;
      }
    }

    console.log(
      `[linkedin-guest] Easy Apply API: ${listings.length} jobs for "${getSearchQuery(profile)}" in ${getSearchLocation(profile)}`
    );

    if (listings.length === 0) {
      return {
        jobs: [],
        warning:
          "LinkedIn guest API returned no Easy Apply jobs. Try Set up LinkedIn login and scan again.",
      };
    }

    return { jobs: listings };
  } catch (err) {
    return {
      jobs: [],
      warning: `LinkedIn guest API failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}
