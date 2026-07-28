import { chromium, type Page } from "playwright";

/** Separate from the Auto Apply profile — logged-in apply cookies often break Indeed SERP scraping. */
export const INDEED_COLLECT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function withIndeedCollectBrowser<T>(
  run: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await browser.newPage({ userAgent: INDEED_COLLECT_USER_AGENT });
    return await run(page);
  } finally {
    await browser.close();
  }
}
