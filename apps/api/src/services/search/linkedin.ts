import type { Browser, BrowserContext, Page } from "playwright";
import type { LinkedInApplyType } from "@jobfinder/shared";
import type { JobListingInput, UserProfile } from "@jobfinder/shared";
import { chromium } from "playwright";
import { env } from "../../config.js";
import { getBrowserProfileDir } from "../apply/browserSession.js";
import { runWithConcurrency } from "./concurrency.js";
import { fetchGuestEasyApplyJobs } from "./linkedinGuestEasyApply.js";
import { fetchPanelVerifiedEasyApplyJobs } from "./linkedinPanelEasyApply.js";
import { buildLinkedInSearchUrl } from "./linkedinSearchUrl.js";
import type { LinkedInFetchResult, LinkedInSearchOptions } from "./linkedinTypes.js";

export type { LinkedInFetchResult, LinkedInSearchOptions } from "./linkedinTypes.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function fetchLinkedInJobs(profile: UserProfile): Promise<JobListingInput[]> {
  const result = await fetchLinkedInJobsDetailed(profile);
  if (result.warning) console.warn(`[linkedin] ${result.warning}`);
  return result.jobs;
}

export type LinkedInBatchProgress = {
  done: number;
  total: number;
  title?: string;
};

/**
 * Easy Apply collect: guest API (f_AL) first, then logged-in panel verification.
 * Regular collect: standard HTML scrape.
 */
export async function fetchLinkedInJobsBatch(
  profiles: UserProfile[],
  options?: LinkedInSearchOptions & {
    onProgress?: (p: LinkedInBatchProgress) => void;
  }
): Promise<LinkedInFetchResult[]> {
  if (profiles.length === 0) return [];

  if (options?.easyApplyOnly) {
    return fetchEasyApplyJobsBatch(profiles, options.onProgress);
  }

  return fetchStandardLinkedInBatch(profiles, options?.onProgress);
}

async function fetchEasyApplyJobsBatch(
  profiles: UserProfile[],
  onProgress?: (p: LinkedInBatchProgress) => void
): Promise<LinkedInFetchResult[]> {
  onProgress?.({ done: 0, total: profiles.length });
  const guestResults = await Promise.all(profiles.map((p) => fetchGuestEasyApplyJobs(p)));
  const guestTotal = guestResults.reduce((n, r) => n + r.jobs.length, 0);

  if (guestTotal > 0) {
    console.log(`[linkedin] Easy Apply collect via guest API: ${guestTotal} jobs total`);
    onProgress?.({ done: profiles.length, total: profiles.length });
    return guestResults;
  }

  console.log("[linkedin] guest API empty — falling back to logged-in panel verification");
  return fetchPanelEasyApplyBatch(profiles, onProgress);
}

async function fetchPanelEasyApplyBatch(
  profiles: UserProfile[],
  onProgress?: (p: LinkedInBatchProgress) => void
): Promise<LinkedInFetchResult[]> {
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(getBrowserProfileDir(), {
      headless: true,
      viewport: { width: 1280, height: 900 },
      userAgent: USER_AGENT,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    const results: LinkedInFetchResult[] = [];
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i]!;
      const title = profile.preferences.titles[0];
      onProgress?.({ done: i, total: profiles.length, title });
      results.push(await fetchPanelVerifiedEasyApplyJobs(page, profile));
      onProgress?.({ done: i + 1, total: profiles.length, title });
    }
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning =
      msg.includes("Executable doesn't exist") || msg.includes("browserType.launch")
        ? "LinkedIn needs Playwright browsers. Run: npm run playwright:install -w @jobfinder/api"
        : `LinkedIn Easy Apply search failed: ${msg}`;
    return profiles.map(() => ({ jobs: [], warning }));
  } finally {
    if (context) await context.close();
  }
}

async function fetchStandardLinkedInBatch(
  profiles: UserProfile[],
  onProgress?: (p: LinkedInBatchProgress) => void
): Promise<LinkedInFetchResult[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning =
      msg.includes("Executable doesn't exist") || msg.includes("browserType.launch")
        ? "LinkedIn needs Playwright browsers. Run: npm run playwright:install -w @jobfinder/api"
        : `LinkedIn search failed: ${msg}`;
    return profiles.map(() => ({ jobs: [], warning }));
  }

  const concurrency = Math.min(env.linkedInCollectConcurrency, profiles.length);
  const results: LinkedInFetchResult[] = new Array(profiles.length);
  let completed = 0;
  const indexed = profiles.map((profile, index) => ({ profile, index }));

  try {
    console.log(`[linkedin] searching ${profiles.length} scope(s) with concurrency=${concurrency}`);
    await runWithConcurrency(indexed, concurrency, async ({ profile, index }) => {
      const page = await browser!.newPage({ userAgent: USER_AGENT });
      try {
        const title = profile.preferences.titles[0];
        onProgress?.({ done: completed, total: profiles.length, title });
        results[index] = await scrapeLinkedInSearch(page, profile);
        completed++;
        onProgress?.({ done: completed, total: profiles.length, title });
      } finally {
        await page.close();
      }
    });
    return results.map((r) => r ?? { jobs: [], warning: "LinkedIn search failed" });
  } finally {
    await browser.close();
  }
}

export async function fetchLinkedInJobsDetailed(profile: UserProfile): Promise<LinkedInFetchResult> {
  const [result] = await fetchLinkedInJobsBatch([profile]);
  return result ?? { jobs: [], warning: "LinkedIn search failed" };
}

async function scrapeLinkedInSearch(
  page: Page,
  profile: UserProfile,
  options?: LinkedInSearchOptions
): Promise<LinkedInFetchResult> {
  const searchUrl = buildLinkedInSearchUrl(profile, options);
  const listings: JobListingInput[] = [];

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);

    const cards = page.locator(
      [
        "li.jobs-search-results__list-item",
        "li[data-occludable-job-id]",
        ".base-card",
        ".job-search-card",
        "ul.jobs-search__results-list li",
      ].join(", ")
    );
    const count = await cards.count();

    for (let i = 0; i < Math.min(count, 25); i++) {
      const card = cards.nth(i);
      try {
        const titleEl = card.locator("h3, .base-search-card__title, .job-card-list__title").first();
        const title = (await titleEl.textContent())?.trim() ?? "";
        if (!title) continue;

        const linkEl = card.locator("a[href*='/jobs/view']").first();
        const href = await linkEl.getAttribute("href");
        if (!href) continue;

        const url = href.split("?")[0];
        const company =
          (
            await card
              .locator("h4, .base-search-card__subtitle, .job-card-container__company-name")
              .first()
              .textContent()
          )?.trim() || "Unknown";
        const location =
          (
            await card
              .locator(".job-search-card__location, .job-card-container__metadata-item")
              .first()
              .textContent()
          )?.trim() || "Ireland";
        const dateText =
          (await card.locator("time, .job-search-card__listdate").first().textContent())?.trim() ||
          "";
        const cardText = (await card.innerText()) ?? "";
        const linkedInApplyType = await detectApplyTypeOnCard(card, cardText);
        const fullUrl = url.startsWith("http") ? url : `https://www.linkedin.com${url}`;

        listings.push({
          externalId: url.split("/").pop() ?? url,
          source: "linkedin",
          title,
          company,
          location,
          url: fullUrl,
          description: "",
          tags: [],
          postedAt: parseLinkedInDate(dateText)?.toISOString(),
          linkedInApplyType,
        });
      } catch {
        /* skip card */
      }
    }

    console.log(`[linkedin] returned ${listings.length} jobs`);
    if (listings.length === 0) {
      return {
        jobs: [],
        warning: "LinkedIn returned no jobs (login wall or rate limit). Try again later.",
      };
    }
    return { jobs: listings };
  } catch (err) {
    return {
      jobs: [],
      warning: `LinkedIn search failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}

async function detectApplyTypeOnCard(
  card: import("playwright").Locator,
  cardText: string
): Promise<LinkedInApplyType> {
  let footer = "";
  try {
    footer =
      (
        await card
          .locator(
            ".job-card-container__apply-method, .job-card-list__footer-wrapper, [class*='apply-method']"
          )
          .first()
          .textContent({ timeout: 500 })
      )?.trim() ?? "";
  } catch {
    /* optional footer */
  }

  const blob = `${cardText} ${footer}`.toLowerCase();

  if (/\beasy\s*apply\b/.test(blob) || /\bapply\s+with\s+linkedin\b/.test(blob)) {
    return "easy_apply";
  }

  try {
    const easyMarkers = await card
      .locator(
        [
          "[class*='easy-apply']",
          "[class*='jobs-apply-button--easy']",
          "[data-tracking-control-name*='easy_apply']",
        ].join(", ")
      )
      .count();
    if (easyMarkers > 0) return "easy_apply";
  } catch {
    /* ignore */
  }

  if (
    /apply\s+on\s+company|company\s+website|off-?site|you will be redirected/i.test(blob)
  ) {
    return "external";
  }

  return "unknown";
}

function parseLinkedInDate(text: string): Date | undefined {
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
