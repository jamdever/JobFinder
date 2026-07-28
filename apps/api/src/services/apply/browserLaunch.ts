import { chromium, type BrowserContext, type LaunchPersistentContextOptions } from "playwright";

export const AUTOMATION_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Reduces bot flags vs stock Playwright Chromium. */
export const AUTOMATION_CHROMIUM_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
];

export function automationContextOptions(headless: boolean): LaunchPersistentContextOptions {
  return {
    headless,
    viewport: { width: 1280, height: 900 },
    args: AUTOMATION_CHROMIUM_ARGS,
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
    userAgent: AUTOMATION_USER_AGENT,
  };
}

/** Prefer installed Chrome — passes Cloudflare more often than bundled Chromium. */
export async function launchPersistentAutomationContext(
  userDataDir: string,
  headless: boolean
): Promise<BrowserContext> {
  const opts: LaunchPersistentContextOptions = {
    ...automationContextOptions(headless),
    ignoreDefaultArgs: ["--enable-automation"],
  };
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...opts,
      channel: "chrome",
    });
  } catch {
    return await chromium.launchPersistentContext(userDataDir, opts);
  }
}
