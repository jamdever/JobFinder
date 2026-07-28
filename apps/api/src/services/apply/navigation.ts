import type { Page } from "playwright";
import { isAuthPageDeep } from "./authDetection.js";
import { safeWait } from "./safePage.js";

const COMPANY_APPLY_PATTERNS = [/apply on company website/i];
const EASY_APPLY_PATTERNS = [/easy apply/i];
const GENERIC_APPLY_PATTERNS = [
  /apply with indeed/i,
  /apply now/i,
  /submit application/i,
  /apply for this job/i,
  /apply on indeed/i,
  /easily apply/i,
  /^apply$/i,
];
const NEXT_PATTERNS = [
  /^review$/i,
  /next/i,
  /continue/i,
  /save and continue/i,
  /proceed/i,
  /done/i,
];
const SUBMIT_PATTERNS = [/submit application/i, /submit/i, /send application/i, /finish/i];

async function clickFirstMatching(
  page: Page,
  patterns: RegExp[],
  options?: { waitForPopup?: boolean }
): Promise<{ clicked: boolean; popup?: Page }> {
  for (const pattern of patterns) {
    try {
      const btn = page
        .getByRole("link", { name: pattern })
        .or(page.getByRole("button", { name: pattern }));
      if ((await btn.count()) === 0) continue;

      const target = btn.first();
      const popupPromise = options?.waitForPopup
        ? page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null)
        : Promise.resolve(null);

      await target.click({ timeout: 8000 });
      await safeWait(page, 1500);

      const popup = await popupPromise;
      if (popup && !popup.isClosed()) {
        await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
        return { clicked: true, popup };
      }
      return { clicked: true };
    } catch {
      /* try next */
    }
  }
  return { clicked: false };
}

/** Generic apply click — avoid on LinkedIn external jobs (use openCompanyApplyFromLinkedIn). */
export async function clickApplyEntry(page: Page): Promise<{
  clicked: boolean;
  popup?: Page;
}> {
  return clickFirstMatching(page, [...COMPANY_APPLY_PATTERNS, ...GENERIC_APPLY_PATTERNS], {
    waitForPopup: true,
  });
}

export async function clickNextStep(page: Page): Promise<boolean> {
  for (const pattern of NEXT_PATTERNS) {
    try {
      const btn = page.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0) {
        const first = btn.first();
        if (await first.isVisible()) {
          await first.click({ timeout: 5000 });
          await safeWait(page, 1500);
          return true;
        }
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function clickSubmit(page: Page): Promise<boolean> {
  for (const pattern of SUBMIT_PATTERNS) {
    try {
      const btn = page.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 8000 });
        await safeWait(page, 3000);
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function pickFormPage(main: Page, popup?: Page): Promise<Page> {
  if (!popup || popup.isClosed()) return main;
  const popupAuth = await isAuthPageDeep(popup);
  const mainAuth = await isAuthPageDeep(main);
  if (popupAuth && !mainAuth) return main;
  if (!popupAuth) return popup;
  return main;
}
