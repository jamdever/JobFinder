import type { Page } from "playwright";
import {
  isCloudflareChallengePage,
  isIndeedJobPageReady,
  isIndeedHomeReady,
  solveCloudflareChallenge,
} from "./cloudflareDetection.js";
import { dismissCookieBanners } from "./pageUtils.js";
import { safeWait } from "./safePage.js";

const INDEED_HOME = "https://ie.indeed.com/";

/** Remove stale Cloudflare cookies that can trap the profile on a failed challenge. */
export async function clearStaleCloudflareCookies(page: Page): Promise<void> {
  try {
    const context = page.context();
    const cookies = await context.cookies();
    const stale = cookies.filter(
      (c) =>
        c.name === "cf_clearance" ||
        c.name === "__cf_bm" ||
        c.name.startsWith("_cfuvid")
    );
    if (stale.length === 0) return;
    const keep = cookies.filter((c) => !stale.some((s) => s.name === c.name && s.domain === c.domain));
    await context.clearCookies();
    if (keep.length > 0) await context.addCookies(keep);
    console.log(`[indeed] Cleared ${stale.length} stale Cloudflare cookie(s)`);
  } catch {
    /* ignore */
  }
}

/**
 * Visit Indeed home first (establishes session), then open the job — avoids cold-link Cloudflare blocks.
 */
export async function navigateIndeedJobWithSession(page: Page, jobUrl: string): Promise<void> {
  await clearStaleCloudflareCookies(page);

  console.log("[indeed] Warming session via ie.indeed.com…");
  await page.goto(INDEED_HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissCookieBanners(page);
  await safeWait(page, 1000);

  let cleared = await solveCloudflareChallenge([page], 180_000, { targetUrl: INDEED_HOME });
  if (!cleared && !(await isIndeedHomeReady(page))) {
    throw new Error(
      "Could not access Indeed.ie. Use “Unlock Indeed access” on this page once, or add CAPSOLVER_API_KEY to .env."
    );
  }

  await safeWait(page, 800);

  console.log("[indeed] Opening job:", jobUrl);
  await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissCookieBanners(page);
  await safeWait(page, 1000);

  cleared = await solveCloudflareChallenge([page], 180_000, { targetUrl: jobUrl });
  if (!cleared && !(await isIndeedJobPageReady(page))) {
    if (await isCloudflareChallengePage(page)) {
      throw new Error(
        "Indeed job page blocked by Cloudflare. Click “Unlock Indeed access” below, or add CAPSOLVER_API_KEY to .env."
      );
    }
  }
}
