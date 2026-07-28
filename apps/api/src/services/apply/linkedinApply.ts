import type { Page } from "playwright";
import type { LinkedInApplyMode } from "@jobfinder/shared";
import {
  evalOnPage,
  LINKEDIN_ALREADY_APPLIED_SCRIPT,
  LINKEDIN_DETECT_APPLY_MODE_SCRIPT,
  LINKEDIN_EXTRACT_COMPANY_URLS_SCRIPT,
} from "./pageEvaluate.js";
import { getActiveApplyTiming } from "./applyTiming.js";
import { safeWait } from "./safePage.js";

function linkedInStepDelayMs(): number {
  return getActiveApplyTiming().linkedInClickDelayMs;
}

export interface LinkedInApplyResolution {
  url: string;
  via: "direct" | "linkedin_external" | "linkedin_easy_apply" | "linkedin_page";
  mode: LinkedInApplyMode;
  companyApplyUrl?: string;
}

function decodeRedirectUrl(href: string): string | null {
  try {
    const u = new URL(href, "https://www.linkedin.com");
    const embedded =
      u.searchParams.get("url") ??
      u.searchParams.get("redirect") ??
      u.searchParams.get("destination");
    if (embedded) {
      return decodeURIComponent(embedded);
    }
    if (!/linkedin\.com/i.test(u.hostname)) return u.toString();
  } catch {
    /* ignore */
  }
  return null;
}

function isOffsiteUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !/linkedin\.com$/i.test(host);
  } catch {
    return false;
  }
}

/** Detect Easy Apply vs Apply on company website (external). */
type LinkedInApplySignals = {
  hasEasyApply: boolean;
  hasCompanyWebsite: boolean;
  offsiteButton: boolean;
  easyApplyButton: boolean;
};

const EMPTY_SIGNALS: LinkedInApplySignals = {
  hasEasyApply: false,
  hasCompanyWebsite: false,
  offsiteButton: false,
  easyApplyButton: false,
};

export async function detectLinkedInApplyMode(page: Page): Promise<LinkedInApplyMode> {
  let signals: LinkedInApplySignals = EMPTY_SIGNALS;
  try {
    signals =
      (await evalOnPage<LinkedInApplySignals>(page, LINKEDIN_DETECT_APPLY_MODE_SCRIPT)) ??
      EMPTY_SIGNALS;
  } catch {
    /* fall through — try Playwright locators below */
  }

  if (!signals.easyApplyButton) {
    try {
      const easy = page.getByRole("button", { name: /easy apply/i });
      if ((await easy.count()) > 0) signals = { ...signals, easyApplyButton: true };
    } catch {
      /* ignore */
    }
  }

  if (signals.easyApplyButton || (signals.hasEasyApply && !signals.offsiteButton)) {
    return "easy_apply";
  }
  if (signals.offsiteButton || signals.hasCompanyWebsite) {
    return "external";
  }
  return "unknown";
}

/** Collect external application URLs from the LinkedIn job page. */
export async function extractCompanyApplyUrls(page: Page): Promise<string[]> {
  const hrefs =
    (await evalOnPage<string[]>(page, LINKEDIN_EXTRACT_COMPANY_URLS_SCRIPT)) ?? [];

  const absolute: string[] = [];
  for (const raw of hrefs) {
    const decoded = decodeRedirectUrl(raw) ?? raw;
    try {
      const url = new URL(decoded, page.url()).toString();
      if (isOffsiteUrl(url)) absolute.push(url);
    } catch {
      /* skip */
    }
  }
  return absolute;
}

export async function resolveLinkedInApplication(
  page: Page,
  jobUrl: string
): Promise<LinkedInApplyResolution> {
  if (!/linkedin\.com\/jobs/i.test(jobUrl)) {
    return { url: jobUrl, via: "direct", mode: "unknown" };
  }

  const mode = await detectLinkedInApplyMode(page);
  const companyUrls = await extractCompanyApplyUrls(page);

  if (companyUrls.length > 0) {
    return {
      url: companyUrls[0],
      via: "linkedin_external",
      mode: mode === "easy_apply" ? "easy_apply" : "external",
      companyApplyUrl: companyUrls[0],
    };
  }

  if (mode === "easy_apply") {
    return { url: jobUrl, via: "linkedin_easy_apply", mode: "easy_apply" };
  }

  if (mode === "external") {
    return {
      url: jobUrl,
      via: "linkedin_page",
      mode: "external",
    };
  }

  return { url: jobUrl, via: "linkedin_page", mode: "unknown" };
}

/** @deprecated use resolveLinkedInApplication */
export async function resolveApplicationUrl(
  page: Page,
  jobUrl: string
): Promise<{ url: string; via: "direct" | "linkedin_external" | "linkedin_page" }> {
  const r = await resolveLinkedInApplication(page, jobUrl);
  const via =
    r.via === "linkedin_easy_apply"
      ? "linkedin_page"
      : (r.via as "direct" | "linkedin_external" | "linkedin_page");
  return { url: r.companyApplyUrl ?? r.url, via };
}

/** Click only the off-site / company website apply control (not Easy Apply). */
export async function openCompanyApplyFromLinkedIn(page: Page): Promise<{
  opened: boolean;
  popup?: import("playwright").Page;
  targetUrl?: string;
}> {
  const urls = await extractCompanyApplyUrls(page);
  if (urls.length > 0) {
    await page.goto(urls[0], { waitUntil: "domcontentloaded", timeout: 90_000 });
    return { opened: true, targetUrl: urls[0] };
  }

  try {
    const link = page.getByRole("link", { name: /apply on company website/i });
    if ((await link.count()) > 0) {
      const popupPromise = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
      await link.first().click({ timeout: 8000 });
      const popup = await popupPromise;
      if (popup && !popup.isClosed()) {
        await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
        return { opened: true, popup, targetUrl: popup.url() };
      }
      return { opened: true, targetUrl: page.url() };
    }
  } catch {
    /* fall through */
  }

  return { opened: false };
}

/** Job posting already shows Applied (no Easy Apply to run). */
export async function detectLinkedInJobAlreadyApplied(page: Page): Promise<boolean> {
  try {
    return await evalOnPage<boolean>(page, LINKEDIN_ALREADY_APPLIED_SCRIPT);
  } catch {
    return false;
  }
}

/** LinkedIn Easy Apply modal container (when open). */
export function linkedInEasyApplyModal(page: Page) {
  return page.locator(
    [
      ".jobs-easy-apply-modal",
      "[data-test-modal]",
      "motion.div[role='dialog']",
      "motion.div[role='dialog']",
      "div[role='dialog']:has(button:has-text('Review'))",
      "motion.div[role='dialog']:has(button:has-text('Review'))",
      "motion.div[role='dialog']:has(button:has-text('Submit'))",
      "div[role='dialog']:has(button:has-text('Submit'))",
    ].join(", ")
  ).first();
}

/** Advance one step in the LinkedIn Easy Apply wizard (Review, Next, Continue, …). */
export async function clickLinkedInEasyApplyNext(page: Page): Promise<boolean> {
  const modal = linkedInEasyApplyModal(page);
  const root = (await modal.count()) > 0 ? modal : page;

  const forwardPatterns = [/^review$/i, /^next$/i, /continue/i, /save and continue/i, /proceed/i];

  for (const pattern of forwardPatterns) {
    try {
      const buttons = root.getByRole("button", { name: pattern });
      const count = await buttons.count();
      for (let i = count - 1; i >= 0; i--) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible().catch(() => false))) continue;
        const label = ((await btn.textContent()) ?? "").toLowerCase();
        if (/\bback\b/.test(label)) continue;
        await btn.click({ timeout: 10_000 });
        await safeWait(page, linkedInStepDelayMs());
        return true;
      }
    } catch {
      /* try next pattern */
    }
  }

  try {
    const primary = root.locator(
      "footer button.artdeco-button--primary:not([disabled]), .jobs-easy-apply-footer button.artdeco-button--primary:not([disabled])"
    );
    const count = await primary.count();
    for (let i = count - 1; i >= 0; i--) {
      const btn = primary.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const label = ((await btn.textContent()) ?? "").toLowerCase();
      if (/\bback\b/.test(label)) continue;
      await btn.click({ timeout: 10_000 });
      await safeWait(page, linkedInStepDelayMs());
      return true;
    }
  } catch {
    /* fall through */
  }

  return false;
}

/** Click Review when visible (skip scanning for Next). */
export async function clickLinkedInReviewButton(page: Page): Promise<boolean> {
  const modal = linkedInEasyApplyModal(page);
  const root = (await modal.count()) > 0 ? modal : page;
  try {
    const review = root.getByRole("button", { name: /^review$/i });
    if ((await review.count()) > 0 && (await review.first().isVisible().catch(() => false))) {
      await review.first().click({ timeout: 8000 });
      await safeWait(page, getActiveApplyTiming().linkedInClickDelayMs);
      return true;
    }
  } catch {
    /* fall through */
  }
  return clickLinkedInEasyApplyNext(page);
}

/** True on the review summary step (Submit application is the primary action). */
export async function isLinkedInEasyApplyReviewSummary(page: Page): Promise<boolean> {
  const modal = linkedInEasyApplyModal(page);
  const root = (await modal.count()) > 0 ? modal : page;
  try {
    const submit = root.getByRole("button", { name: /submit application/i });
    if ((await submit.count()) > 0 && (await submit.first().isVisible().catch(() => false))) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** On the final Easy Apply step (Review visible or Submit application). */
export async function isLinkedInEasyApplyAtReviewOrSubmit(page: Page): Promise<boolean> {
  if (await isLinkedInEasyApplyReviewSummary(page)) return true;
  const modal = linkedInEasyApplyModal(page);
  const root = (await modal.count()) > 0 ? modal : page;
  const patterns = [/^review$/i, /submit application/i, /^submit$/i];
  for (const pattern of patterns) {
    try {
      const btn = root.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0 && (await btn.first().isVisible().catch(() => false))) {
        return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

/** True when LinkedIn shows a post-submit confirmation. */
export async function detectLinkedInApplicationSubmitted(page: Page): Promise<boolean> {
  try {
    const text = (await page.locator("body").innerText({ timeout: 5000 })).toLowerCase();
    if (
      /application (was )?sent|your application was sent|successfully applied|you applied for|application has been submitted/i.test(
        text
      )
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Submit inside the Easy Apply modal. */
export async function clickLinkedInEasyApplySubmit(page: Page): Promise<boolean> {
  const modal = linkedInEasyApplyModal(page);
  const inModal = (await modal.count()) > 0;
  const root = inModal ? modal : page;

  if (!(await isLinkedInEasyApplyReviewSummary(page))) {
    if (await isLinkedInEasyApplyAtReviewOrSubmit(page)) {
      await clickLinkedInReviewButton(page);
      await safeWait(page, getActiveApplyTiming().formStabilityMs);
    }
  }

  const patterns = [/submit application/i, /^submit$/i, /finish/i];
  for (const pattern of patterns) {
    try {
      const btn = root.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0) {
        await btn.last().click({ timeout: 10_000 });
        await safeWait(page, Math.round(linkedInStepDelayMs() * 1.6));
        if (await detectLinkedInApplicationSubmitted(page)) return true;
        if (!inModal || (await linkedInEasyApplyModal(page).count()) === 0) return true;
        return true;
      }
    } catch {
      /* next */
    }
  }

  try {
    const footerSubmit = root.locator(
      [
        "footer button.artdeco-button--primary",
        'button[aria-label*="Submit" i]',
        'button[data-control-name="submit_unify"]',
        'button:has-text("Submit application")',
      ].join(", ")
    );
    const n = await footerSubmit.count();
    for (let i = n - 1; i >= 0; i--) {
      const btn = footerSubmit.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const label = ((await btn.textContent()) ?? "").toLowerCase();
      if (/\bback\b/.test(label)) continue;
      if (!/submit|finish/i.test(label)) continue;
      await btn.click({ timeout: 10_000 });
      await safeWait(page, Math.round(linkedInStepDelayMs() * 1.6));
      if (await detectLinkedInApplicationSubmitted(page)) return true;
      if (!inModal || (await linkedInEasyApplyModal(page).count()) === 0) return true;
      return true;
    }
  } catch {
    /* fall through */
  }

  return false;
}

/** Dismiss LinkedIn "application sent" overlay so the browser can close cleanly. */
export async function dismissLinkedInPostApplyDialog(page: Page): Promise<void> {
  const patterns = [/done/i, /dismiss/i, /close/i, /no thanks/i];
  for (const pattern of patterns) {
    try {
      const btn = page.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 3000 });
        await safeWait(page, 800);
        return;
      }
    } catch {
      /* next */
    }
  }
}

/** Click LinkedIn Easy Apply (in-page modal). */
export async function clickLinkedInEasyApply(page: Page): Promise<boolean> {
  const selectors = [
    () => page.getByRole("button", { name: /easy apply/i }),
    () => page.getByRole("link", { name: /easy apply/i }),
    () => page.locator("button.jobs-apply-button--easy-apply, .jobs-s-apply button"),
    () => page.locator("[aria-label*='Easy Apply' i]"),
  ];

  for (const locatorFn of selectors) {
    try {
      const loc = locatorFn();
      if ((await loc.count()) > 0) {
        await loc.first().click({ timeout: 10_000 });
        await safeWait(page, linkedInStepDelayMs());
        return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

