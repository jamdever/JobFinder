import * as cheerio from "cheerio";
import type { JobListingInput } from "@jobfinder/shared";
import type { Page } from "playwright";
import { runWithConcurrency } from "./concurrency.js";
import { runWithSharedBrowserProfile } from "../apply/browserSession.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MIN_DESC_LEN = 120;
const MAX_DETAIL_FETCHES = 8;

/** Stable Indeed viewjob URL for description scraping. */
export function indeedViewJobUrl(job: { url: string; externalId?: string }): string {
  const fromUrl = job.url.match(/[?&]jk=([a-zA-Z0-9]+)/)?.[1];
  const jk = fromUrl ?? job.externalId?.match(/^([a-zA-Z0-9]+)$/)?.[1];
  if (jk) return `https://ie.indeed.com/viewjob?jk=${jk}`;
  if (/indeed\.com/i.test(job.url) && job.url.includes("viewjob")) {
    return job.url.split("#")[0] ?? job.url;
  }
  return job.url;
}

export function parseIndeedDescriptionHtml(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  const selectors = [
    "#jobDescriptionText",
    ".jobsearch-JobComponent-description",
    '[data-testid="jobsearch-JobComponent-description"]',
    "#job-details-jobs-ugc-body",
  ];
  for (const sel of selectors) {
    const t = $(sel).text().trim();
    if (t.length > parts.reduce((a, b) => Math.max(a, b.length), 0)) parts.push(t);
  }
  return parts.sort((a, b) => b.length - a.length)[0]?.replace(/\s+/g, " ").trim() ?? "";
}

export async function fetchIndeedDescriptionFromPage(
  page: Page,
  viewUrl: string
): Promise<string> {
  await page.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(600);
  const locator = page.locator(
    "#jobDescriptionText, .jobsearch-JobComponent-description, [data-testid='jobsearch-JobComponent-description']"
  );
  const fromLocator = await locator
    .first()
    .textContent({ timeout: 8000 })
    .catch(() => null);
  if (fromLocator && fromLocator.trim().length >= MIN_DESC_LEN) {
    return fromLocator.replace(/\s+/g, " ").trim();
  }
  return parseIndeedDescriptionHtml(await page.content());
}

export async function fetchIndeedDescriptionStandalone(viewUrl: string): Promise<string> {
  return runWithSharedBrowserProfile(true, (page) =>
    fetchIndeedDescriptionFromPage(page, viewUrl)
  );
}

/** Load full posting text for Indeed cards that only have a search snippet. */
export async function enrichIndeedListings(
  jobs: JobListingInput[],
  page?: Page
): Promise<number> {
  const targets = jobs.filter(
    (j) =>
      j.source === "indeed" &&
      (j.description?.length ?? 0) < MIN_DESC_LEN
  ).slice(0, MAX_DETAIL_FETCHES);

  if (targets.length === 0) return 0;

  const results = await runWithConcurrency(targets, 3, async (job) => {
    const viewUrl = indeedViewJobUrl(job);
    try {
      const desc = page
        ? await fetchIndeedDescriptionFromPage(page, viewUrl)
        : await fetchIndeedDescriptionStandalone(viewUrl);
      return { job, desc };
    } catch (err) {
      console.warn(
        `[indeed] description fetch failed for "${job.title}":`,
        err instanceof Error ? err.message : err
      );
      return { job, desc: "" };
    }
  });

  let fetched = 0;
  for (const { job, desc } of results) {
    if (desc.length > (job.description?.length ?? 0)) {
      job.description = desc;
      fetched++;
    }
  }
  if (fetched > 0) {
    console.log(`[indeed] loaded full descriptions for ${fetched} job(s)`);
  }
  return fetched;
}
