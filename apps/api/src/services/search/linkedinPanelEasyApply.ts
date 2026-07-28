import type { Page } from "playwright";
import type { JobListingInput, UserProfile } from "@jobfinder/shared";
import { detectLinkedInApplyMode } from "../apply/linkedinApply.js";
import type { LinkedInFetchResult } from "./linkedinTypes.js";
import { buildLinkedInSearchUrl } from "./linkedinSearchUrl.js";

const LIST_ITEM =
  "li.jobs-search-results__list-item, li[data-occludable-job-id], .scaffold-layout__list li";

/**
 * Logged-in split view: click each result and read the job detail panel apply button
 * (same signals as Auto Apply submission).
 */
export async function fetchPanelVerifiedEasyApplyJobs(
  page: Page,
  profile: UserProfile
): Promise<LinkedInFetchResult> {
  const searchUrl = buildLinkedInSearchUrl(profile, { easyApplyOnly: true });
  const listings: JobListingInput[] = [];
  const externalUrls: string[] = [];

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(3000);

  const items = page.locator(LIST_ITEM);
  const count = await items.count();
  if (count === 0) {
    return {
      jobs: [],
      warning: "No job list on LinkedIn (sign in via Set up LinkedIn login).",
    };
  }

  const limit = Math.min(count, 25);
  let verified = 0;
  let skipped = 0;

  for (let i = 0; i < limit; i++) {
    const item = items.nth(i);
    try {
      const link = item.locator("a[href*='/jobs/view']").first();
      const href = await link.getAttribute("href");
      if (!href) continue;

      const fullUrl = href.startsWith("http")
        ? href.split("?")[0]
        : `https://www.linkedin.com${href.split("?")[0]}`;

      await link.click({ timeout: 8000 });
      await page.waitForTimeout(1200);

      const mode = await detectLinkedInApplyMode(page);
      if (mode !== "easy_apply") {
        if (mode === "external") externalUrls.push(fullUrl);
        skipped++;
        continue;
      }

      const title =
        (
          await page
            .locator(
              ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1"
            )
            .first()
            .textContent()
        )?.trim() ||
        (await item.locator("h3, .job-card-list__title").first().textContent())?.trim() ||
        "";
      if (!title) continue;

      const company =
        (
          await page
            .locator(
              ".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name"
            )
            .first()
            .textContent()
        )?.trim() ||
        (await item.locator("h4, .job-card-container__company-name").first().textContent())?.trim() ||
        "Unknown";

      const location =
        (
          await page
            .locator(
              ".job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet"
            )
            .first()
            .textContent()
        )?.trim() ||
        (await item.locator(".job-search-card__location").first().textContent())?.trim() ||
        "Ireland";

      listings.push({
        externalId: fullUrl.match(/(\d{8,})/)?.[1] ?? fullUrl,
        source: "linkedin",
        title,
        company,
        location,
        url: fullUrl,
        description: "",
        tags: [],
        linkedInApplyType: "easy_apply",
      });
      verified++;
    } catch {
      skipped++;
    }
  }

  console.log(
    `[linkedin-panel] verified ${verified} Easy Apply` +
      (skipped > 0 ? ` · skipped ${skipped}` : "")
  );

  if (listings.length === 0) {
    return {
      jobs: [],
      externalUrls: externalUrls.length > 0 ? externalUrls : undefined,
      warning: "No Easy Apply jobs verified on LinkedIn job pages. Sign in and try again.",
    };
  }

  return {
    jobs: listings,
    externalUrls: externalUrls.length > 0 ? externalUrls : undefined,
  };
}
