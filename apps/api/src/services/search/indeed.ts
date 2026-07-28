import * as cheerio from "cheerio";
import type { JobListingInput, UserProfile } from "@jobfinder/shared";
import { env } from "../../config.js";
import { withIndeedCollectBrowser } from "./indeedBrowser.js";
import {
  getIndeedSearchQueries,
  getMaxPostedDays,
  getSearchLocation,
} from "./utils.js";
import { enrichIndeedListings } from "./indeedDetail.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type IndeedFetchResult = { jobs: JobListingInput[]; warning?: string };

/** Indeed Ireland: Adzuna API → HTML → Playwright fallback */
export async function fetchIndeedJobs(profile: UserProfile): Promise<JobListingInput[]> {
  const result = await fetchIndeedJobsDetailed(profile);
  if (result.warning) console.warn(`[indeed] ${result.warning}`);
  return result.jobs;
}

export async function fetchIndeedJobsDetailed(profile: UserProfile): Promise<IndeedFetchResult> {
  const queries = getIndeedSearchQueries(profile);
  const maxDays = getMaxPostedDays(profile);
  const where = getSearchLocation(profile);
  // Indeed "last 24 hours" often returns empty for Ireland; floor at 3 days for collect.
  const searchDays = Math.max(maxDays, 3);

  console.log(
    `[indeed] queries=${JSON.stringify(queries)} where="${where}" fromage=${searchDays}`
  );

  const allJobs: JobListingInput[] = [];
  let warning: string | undefined;

  for (const query of queries) {
    const result = await fetchIndeedJobsForQuery(query, where, searchDays);
    allJobs.push(...result.jobs);
    if (result.warning) warning = result.warning;
    if (allJobs.length >= 40) break;
  }

  const jobs = dedupeIndeedJobs(allJobs);
  if (jobs.length > 0) {
    return { jobs };
  }

  return {
    jobs: [],
    warning:
      warning ??
      `No Indeed Ireland results for: ${queries.join(" · ")}. Try widening "Posted within" in Settings.`,
  };
}

async function fetchIndeedJobsForQuery(
  query: string,
  where: string,
  maxDays: number
): Promise<IndeedFetchResult> {
  const fromAdzuna = await fetchIndeedViaAdzuna(query, where, maxDays);
  if (fromAdzuna.length > 0) {
    return { jobs: fromAdzuna };
  }

  const fromHtml = await fetchIndeedHtml(query, where, maxDays);
  if (fromHtml.length > 0) {
    if (env.collectIndeedDescriptions) await enrichIndeedListings(fromHtml);
    return { jobs: fromHtml };
  }

  const ieCountry = env.adzunaCountry.toLowerCase() === "ie";
  if (ieCountry && !env.indeedUsePlaywright) {
    return {
      jobs: [],
      warning:
        "Indeed.ie browser search is off (set COLLECT_INDEED_PLAYWRIGHT=1 in .env, or remove COLLECT_INDEED_PLAYWRIGHT=0).",
    };
  }

  if (ieCountry) {
    console.log(`[indeed] Searching Indeed.ie in browser for "${query}"…`);
  }

  const fromBrowser = await fetchIndeedPlaywright(query, where, maxDays);
  if (fromBrowser.length > 0) {
    return { jobs: fromBrowser };
  }

  const adzunaHint =
    !env.adzunaAppId || !env.adzunaAppKey
      ? " Add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env (free at developer.adzuna.com)."
      : "";

  return {
    jobs: [],
    warning: `No Indeed Ireland results from scraper.${adzunaHint} (Adzuna API does not list Ireland — Indeed.ie uses browser search.)`,
  };
}

function dedupeIndeedJobs(jobs: JobListingInput[]): JobListingInput[] {
  const seen = new Set<string>();
  const out: JobListingInput[] = [];
  for (const job of jobs) {
    const key = (job.externalId || job.url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

async function fetchIndeedViaAdzuna(
  query: string,
  where: string,
  maxDays: number
): Promise<JobListingInput[]> {
  if (!env.adzunaAppId || !env.adzunaAppKey) return [];

  // Adzuna has no Ireland (ie) feed — Ireland Indeed uses Playwright on ie.indeed.com
  const country = env.adzunaCountry.toLowerCase();
  if (country === "ie") {
    console.log("[indeed] Adzuna has no Ireland API; using Indeed.ie browser search");
    return [];
  }

  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1`;
  const params = new URLSearchParams({
    app_id: env.adzunaAppId,
    app_key: env.adzunaAppKey,
    what: query,
    where,
    results_per_page: "25",
    max_days_old: String(maxDays),
  });

  const res = await fetch(`${url}?${params}`);
  if (!res.ok) {
    console.warn(`[indeed] Adzuna API failed: ${res.status}`);
    return [];
  }

  const data = (await res.json()) as { results: Record<string, unknown>[] };
  return (data.results ?? [])
    .map((item) => ({
      externalId: `adzuna-${item.id}`,
      source: "indeed",
      title: String(item.title ?? "Unknown"),
      company: String((item.company as { display_name?: string })?.display_name ?? "Unknown"),
      location: String((item.location as { display_name?: string })?.display_name ?? "Ireland"),
      url: String(item.redirect_url ?? ""),
      description: String(item.description ?? ""),
      tags: [],
      salary: item.salary_min ? String(item.salary_min) : "",
      postedAt: item.created ? String(item.created) : undefined,
    }))
    .filter((j) => j.url);
}

async function fetchIndeedHtml(
  query: string,
  where: string,
  maxDays: number
): Promise<JobListingInput[]> {
  const fromage = Math.min(maxDays, 14);
  const searchUrl = `https://ie.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(where)}&fromage=${fromage}`;

  const res = await fetch(searchUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "en-IE,en;q=0.9" },
  });
  if (!res.ok) {
    console.warn(`[indeed] HTML fetch failed: ${res.status}`);
    return [];
  }

  return parseIndeedHtml(await res.text());
}

async function fetchIndeedPlaywright(
  query: string,
  where: string,
  maxDays: number
): Promise<JobListingInput[]> {
  const fromage = Math.min(maxDays, 14);
  const searchUrl = `https://ie.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(where)}&fromage=${fromage}`;

  try {
    return await withIndeedCollectBrowser(async (page) => {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
      await page
        .waitForSelector("a[data-jk], .job_seen_beacon", { timeout: 12_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
      const html = await page.content();
      const jobs = parseIndeedHtml(html);
      if (jobs.length === 0) {
        const pageTitle = await page.title();
        console.warn(
          `[indeed] Playwright parsed 0 jobs (${html.length} bytes, title: ${pageTitle})`
        );
      } else if (env.collectIndeedDescriptions) {
        await enrichIndeedListings(jobs, page);
      }
      console.log(`[indeed] Playwright returned ${jobs.length} jobs`);
      return jobs;
    });
  } catch (err) {
    console.warn("[indeed] Playwright failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

function parseIndeedHtml(html: string): JobListingInput[] {
  const $ = cheerio.load(html);
  const listings: JobListingInput[] = [];

  $(".job_seen_beacon, .jobsearch-SerpJobCard, [data-jk]").each((_, el) => {
    const card = $(el);
    const titleEl = card.find("h2 a, .jcs-JobTitle, a[data-jk]").first();
    const title = titleEl.text().trim();
    const href = titleEl.attr("href");
    if (!title || !href) return;

    const jobKey =
      card.attr("data-jk") || href.match(/[?&]jk=([a-zA-Z0-9]+)/)?.[1] || href;
    const url = href.startsWith("http")
      ? href
      : `https://ie.indeed.com${href.startsWith("/") ? href : `/${href}`}`;
    const company = card.find(".companyName, [data-testid='company-name']").first().text().trim();
    const location = card.find(".companyLocation, [data-testid='text-location']").first().text().trim();
    const snippet = card.find(".job-snippet, [data-testid='job-snippet']").text().trim();
    const dateText = card.find(".date, [data-testid='myJobsStateDate']").first().text().trim();

    listings.push({
      externalId: String(jobKey),
      source: "indeed",
      title,
      company: company || "Unknown",
      location: location || "Ireland",
      url,
      description: snippet,
      tags: [],
      postedAt: parseRelativeDate(dateText)?.toISOString(),
    });
  });

  return listings;
}

function parseRelativeDate(text: string): Date | undefined {
  const t = text.toLowerCase();
  const now = new Date();
  if (t.includes("today") || t.includes("just posted")) return now;
  if (t.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return now;
  }
  const m = t.match(/(\d+)\s*day/);
  if (m) {
    now.setDate(now.getDate() - Number(m[1]));
    return now;
  }
  return undefined;
}
