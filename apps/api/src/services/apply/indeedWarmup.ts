import type { UnlockIndeedAccessResultDto } from "@jobfinder/shared";
import { isAutomationBrowserBusy } from "./browserLock.js";
import { launchAutomationContext } from "./browserSession.js";
import { hasCaptchaSolverConfigured } from "./captchaSolvers.js";
import {
  isCloudflareChallengePage,
  isIndeedHomeReady,
  solveCloudflareChallenge,
} from "./cloudflareDetection.js";
import {
  getIndeedCloudflareStatus,
  markIndeedCloudflareAccessSaved,
  persistIndeedBrowserAccess,
  toUnlockIndeedResult,
} from "./indeedCloudflare.js";
import { clearStaleCloudflareCookies } from "./indeedSession.js";
import { dismissCookieBanners } from "./pageUtils.js";

const INDEED_HOME = "https://ie.indeed.com/";

/**
 * Opens the apply browser on Indeed.ie until the homepage loads (saves cf_clearance in profile).
 * Completes Turnstile automatically when CAPSOLVER_API_KEY / TWOCAPTCHA_API_KEY is set.
 */
export async function unlockIndeedBrowserAccess(): Promise<UnlockIndeedAccessResultDto> {
  if (isAutomationBrowserBusy()) {
    throw new Error("Auto Apply is using the browser. Wait for it to finish, then try again.");
  }

  const capsolverConfigured = hasCaptchaSolverConfigured();
  const manualHint = capsolverConfigured
    ? "Solving Cloudflare in the apply browser…"
    : "Complete “Verify you are human” in the apply browser window if it appears — access saves when Indeed.ie loads.";

  const { page, close } = await launchAutomationContext(false);

  try {
    await clearStaleCloudflareCookies(page);
    await page.goto(INDEED_HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissCookieBanners(page);

    if (await persistIndeedBrowserAccess(page)) {
      const savedAt = await markIndeedCloudflareAccessSaved();
      return toUnlockIndeedResult(true, capsolverConfigured, savedAt);
    }

    const deadline = Date.now() + (capsolverConfigured ? 300_000 : 480_000);

    while (Date.now() < deadline) {
      await solveCloudflareChallenge([page], 60_000, { targetUrl: INDEED_HOME });

      if (await persistIndeedBrowserAccess(page)) {
        const savedAt = await markIndeedCloudflareAccessSaved();
        return toUnlockIndeedResult(true, capsolverConfigured, savedAt);
      }

      if (!(await isCloudflareChallengePage(page))) {
        await page.waitForTimeout(2000);
        if (await persistIndeedBrowserAccess(page)) {
          const savedAt = await markIndeedCloudflareAccessSaved();
          return toUnlockIndeedResult(true, capsolverConfigured, savedAt);
        }
      }

      await page.waitForTimeout(2500);
    }

    throw new Error(
      capsolverConfigured
        ? "Indeed unlock timed out. Check CAPSOLVER_API_KEY in .env or complete verification in the browser before it closes."
        : `${manualHint} Timed out — try again and finish the checkbox before the window closes.`
    );
  } finally {
    try {
      await page.waitForTimeout(800);
      await close();
    } catch {
      /* ignore */
    }
  }
}

/** Status for UI — whether Cloudflare access is already saved. */
export async function getIndeedUnlockStatus(): Promise<{
  cloudflareReady: boolean;
  cloudflareUnlockedAt?: string;
  capsolverConfigured: boolean;
}> {
  const cf = await getIndeedCloudflareStatus();
  return { ...cf, capsolverConfigured: hasCaptchaSolverConfigured() };
}
