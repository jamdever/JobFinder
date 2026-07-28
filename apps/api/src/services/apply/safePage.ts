import type { Page } from "playwright";

/** waitForTimeout that no-ops if the page/context was closed (e.g. user closed the browser). */
export async function safeWait(page: Page, ms: number): Promise<void> {
  try {
    if (page.isClosed()) return;
    await page.waitForTimeout(ms);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/has been closed|Target closed|context.*closed/i.test(msg)) return;
    throw err;
  }
}

export async function safeScreenshot(
  page: Page,
  options: Parameters<Page["screenshot"]>[0]
): Promise<void> {
  try {
    if (page.isClosed()) return;
    await page.screenshot(options);
  } catch {
    /* ignore */
  }
}
