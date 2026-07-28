import type { Locator, Page } from "playwright";
import type { UserProfile } from "@jobfinder/shared";
import { indeedViewJobUrl } from "../search/indeedDetail.js";
import { uploadCvPdf } from "./fileUpload.js";
import { fillIndeedEmployerQuestions } from "./indeedEmployerQuestions.js";
import { fillKnownFields } from "./formFiller.js";
import { hasVisibleValidationErrors } from "./discoverFormQuestions.js";
import { completeIndeedScreeningStep } from "./indeedScreeningFill.js";
import { answerScreeningQuestions } from "./questionFiller.js";
import { dismissCookieBanners } from "./pageUtils.js";
import {
  isCloudflareChallengePage,
  isIndeedJobPageReady,
  solveCloudflareChallenge,
} from "./cloudflareDetection.js";
import { getActiveApplyTiming } from "./applyTiming.js";
import { safeWait } from "./safePage.js";

export type IndeedApplyMode = "easy_apply" | "external" | "unknown";

export function normalizeIndeedJobUrl(url: string, externalId?: string): string {
  return indeedViewJobUrl({ url, externalId });
}

export function isIndeedSmartApplyUrl(url: string): boolean {
  return /smartapply\.indeed\.com/i.test(url);
}

export async function waitForIndeedJobPage(page: Page, targetUrl?: string): Promise<void> {
  const goal = targetUrl ?? page.url();
  if ((await isCloudflareChallengePage(page)) || !(await isIndeedJobPageReady(page))) {
    const cleared = await solveCloudflareChallenge([page], 180_000, { targetUrl: goal });
    if (!cleared) {
      throw new Error(
        "Cloudflare blocked Indeed. Install Chrome for Auto Apply, or set CAPSOLVER_API_KEY in .env."
      );
    }
  }

  await page
    .waitForSelector(
      "#applyButtonLinkContainer, [data-testid='applyButton'], button:has-text('Apply')",
      { timeout: 20_000 }
    )
    .catch(() => undefined);
  await safeWait(page, 1500);
}

export async function detectIndeedApplyMode(page: Page): Promise<IndeedApplyMode> {
  try {
    if (isIndeedSmartApplyUrl(page.url())) return "easy_apply";
    await waitForIndeedJobPage(page);
    const withIndeed = page.getByRole("button", { name: /apply with indeed/i }).or(
      page.getByRole("link", { name: /apply with indeed/i })
    );
    if ((await withIndeed.count()) > 0) return "easy_apply";

    const easily = page.getByRole("button", { name: /easily apply/i }).or(
      page.getByRole("link", { name: /easily apply/i })
    );
    if ((await easily.count()) > 0) return "easy_apply";

    const company = page.getByRole("button", { name: /apply on company site/i }).or(
      page.getByRole("link", { name: /apply on company site/i })
    );
    if ((await company.count()) > 0) return "external";
  } catch {
    /* page transitioning */
  }
  return "unknown";
}

/** Opens Indeed Smart Apply (smartapply.indeed.com). */
export async function clickIndeedEasyApply(page: Page): Promise<boolean> {
  const patterns = [/apply with indeed/i, /easily apply/i];
  for (const pattern of patterns) {
    try {
      const btn = page
        .getByRole("button", { name: pattern })
        .or(page.getByRole("link", { name: pattern }));
      if ((await btn.count()) === 0) continue;
      await btn.first().click({ timeout: 10_000 });
      await safeWait(page, getActiveApplyTiming().formStabilityMs);
      try {
        await page.waitForURL(/smartapply\.indeed\.com/i, { timeout: 20_000 });
      } catch {
        /* may stay on viewjob with embedded flow */
      }
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function clickIndeedContinue(page: Page): Promise<boolean> {
  if (await isIndeedSubmitVisible(page)) return false;

  const patterns = [/^continue$/i, /^next$/i, /save and continue/i];

  for (const pattern of patterns) {
    try {
      const buttons = page.getByRole("button", { name: pattern });
      const count = await buttons.count();
      for (let i = count - 1; i >= 0; i--) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible().catch(() => false))) continue;
        if (!(await btn.isEnabled().catch(() => true))) continue;
        await btn.click({ timeout: 10_000 });
        await safeWait(page, getActiveApplyTiming().formStabilityMs);
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        return true;
      }
    } catch {
      /* try next */
    }
  }

  try {
    const dataBtn = page.locator(
      'button[data-testid*="continue" i], button[data-tn-element*="continue" i], [id*="continue-button"]'
    );
    if ((await dataBtn.count()) > 0) {
      await dataBtn.last().click({ timeout: 8000, force: true });
      await safeWait(page, getActiveApplyTiming().formStabilityMs);
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/** Scroll Smart Apply pages so footer Submit / Continue controls are in view. */
export async function scrollIndeedSmartApplyToActions(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    for (const el of document.querySelectorAll(
      "main, [role='main'], form, [class*='PageContent'], [class*='page-content']"
    )) {
      const node = el as HTMLElement;
      if (node.scrollHeight > node.clientHeight + 40) {
        node.scrollTop = node.scrollHeight;
      }
    }
  });
  await safeWait(page, 700);
  await page.keyboard.press("End").catch(() => undefined);
  await safeWait(page, 400);
}

const INDEED_SUBMIT_BUTTON_PATTERNS = [
  /submit your application/i,
  /submit application/i,
  /send application/i,
  /^submit$/i,
];

/** Locate the primary Submit control (after scrolling on review pages). */
export async function findIndeedSubmitButton(page: Page): Promise<Locator | null> {
  await scrollIndeedSmartApplyToActions(page);

  for (const pattern of INDEED_SUBMIT_BUTTON_PATTERNS) {
    const buttons = page.getByRole("button", { name: pattern });
    const count = await buttons.count();
    for (let i = count - 1; i >= 0; i--) {
      const btn = buttons.nth(i);
      try {
        await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
        if (await btn.isVisible()) return btn;
      } catch {
        /* try next */
      }
    }
  }

  const linkish = page
    .locator('a, button, [role="button"], [role="link"]')
    .filter({ hasText: /submit your application|submit application/i });
  const linkCount = await linkish.count();
  for (let i = linkCount - 1; i >= 0; i--) {
    const btn = linkish.nth(i);
    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
      if (await btn.isVisible()) return btn;
    } catch {
      /* next */
    }
  }

  const fallback = page
    .locator(
      'button[type="submit"], input[type="submit"], button[data-testid*="submit" i], button[id*="submit" i]'
    )
    .filter({ hasText: /submit/i });
  const n = await fallback.count();
  for (let i = n - 1; i >= 0; i--) {
    const btn = fallback.nth(i);
    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
      if (await btn.isVisible()) return btn;
    } catch {
      /* next */
    }
  }

  return null;
}

export async function isIndeedSubmitVisible(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    const onReviewUrl =
      /smartapply\.indeed\.com/i.test(url) &&
      /review-module|\/review|\/summary|\/submit|\/confirmation|\/preview/i.test(url);

    if (onReviewUrl || (await isIndeedReviewStep(page))) {
      return (await findIndeedSubmitButton(page)) != null;
    }

    const submit = await findIndeedSubmitButton(page);
    return submit != null;
  } catch {
    return false;
  }
}

export async function isIndeedReviewStep(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (/review|summary|preview/i.test(url)) return true;

    const body = await page.locator("body").innerText();
    return /review your application|review and submit|almost done|ready to submit/i.test(
      body
    );
  } catch {
    return false;
  }
}

/** True when Smart Apply reached the final review/submit stage (dry run success). */
export async function isIndeedSmartApplyReadyToSubmit(page: Page): Promise<boolean> {
  const url = page.url();
  if (
    /smartapply\.indeed\.com/i.test(url) &&
    /review-module|\/review|\/summary/i.test(url)
  ) {
    return (await findIndeedSubmitButton(page)) != null;
  }
  return (await isIndeedSubmitVisible(page)) || (await isIndeedReviewStep(page));
}

/**
 * On the review step: scroll to the footer and optionally click Submit.
 * Dry run passes clickSubmit: false (only scrolls into view).
 */
export async function finalizeIndeedReviewStep(
  page: Page,
  opts: { clickSubmit?: boolean } = {}
): Promise<{ foundSubmit: boolean; clicked: boolean }> {
  const onReview =
    /review-module|\/review|\/summary/i.test(page.url()) || (await isIndeedReviewStep(page));
  if (!onReview) {
    return { foundSubmit: false, clicked: false };
  }

  const btn = await findIndeedSubmitButton(page);
  if (!btn) {
    return { foundSubmit: false, clicked: false };
  }

  if (opts.clickSubmit) {
    try {
      await btn.click({ timeout: 12_000 });
      await safeWait(page, 2500);
      return { foundSubmit: true, clicked: true };
    } catch {
      return { foundSubmit: true, clicked: false };
    }
  }

  return { foundSubmit: true, clicked: false };
}

export async function clickIndeedSubmit(page: Page): Promise<boolean> {
  const { foundSubmit, clicked } = await finalizeIndeedReviewStep(page, {
    clickSubmit: true,
  });
  if (clicked) return true;
  if (foundSubmit) return false;

  const btn = await findIndeedSubmitButton(page);
  if (!btn) return false;
  try {
    await btn.click({ timeout: 10_000 });
    await safeWait(page, 3000);
    return true;
  } catch {
    return false;
  }
}

export async function detectIndeedApplicationSubmitted(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (/confirmation|success|submitted|thank/i.test(url)) return true;
    const text = await page.locator("body").innerText();
    return /application submitted|you applied|thanks for applying|application sent/i.test(text);
  } catch {
    return false;
  }
}

/** Resume-selection and other Smart Apply steps often need a choice before Continue works. */
export async function prepareIndeedSmartApplyStep(page: Page): Promise<void> {
  try {
    const resumeBlock = page
      .locator("section, fieldset, div")
      .filter({ hasText: /resume|cv/i })
      .filter({ has: page.locator('input[type="radio"]') })
      .first();
    if ((await resumeBlock.count()) > 0) {
      const unchecked = resumeBlock.locator('input[type="radio"]:not(:checked)');
      if ((await unchecked.count()) > 0) {
        await unchecked.first().check({ force: true }).catch(() => undefined);
        await safeWait(page, 500);
      }
    }
    const selects = page.locator("select");
    if ((await selects.count()) > 0) {
      const first = selects.first();
      const options = await first.locator("option").count();
      if (options > 1) {
        await first.selectOption({ index: 1 }).catch(() => undefined);
        await safeWait(page, 400);
      }
    }
  } catch {
    /* optional */
  }
}

/** Advance Smart Apply steps until Submit is visible (dry run / pre-submit). */
export async function advanceIndeedApplyToSubmit(page: Page, maxPasses: number): Promise<boolean> {
  const { reachedSubmit } = await runIndeedSmartApplyUntilSubmit(page, {
    coverLetter: "",
    profile: { preferences: { titles: [] }, search: { sources: [] } } as UserProfile,
    screeningAnswers: {},
    cvPdfPath: "",
    resumeText: "",
    maxPasses,
    tryUploadCv: false,
  });
  return reachedSubmit;
}

/** Fill each Smart Apply step and click Continue until Submit / Review. */
export async function runIndeedSmartApplyUntilSubmit(
  page: Page,
  opts: {
    coverLetter: string;
    profile: UserProfile;
    screeningAnswers: Record<string, string>;
    cvPdfPath: string;
    resumeText: string;
    maxPasses: number;
    tryUploadCv: boolean;
  }
): Promise<{
  reachedSubmit: boolean;
  continueClicks: number;
  resumeUploaded: boolean;
  finalUrl: string;
  hasValidation: boolean;
}> {
  let continueClicks = 0;
  let resumeUploaded = false;
  let lastUrl = "";
  let stuckOnUrl = 0;

  for (let pass = 0; pass < opts.maxPasses; pass++) {
    await dismissCookieBanners(page);

    if (/review-module|\/review/i.test(page.url())) {
      const review = await finalizeIndeedReviewStep(page, { clickSubmit: false });
      if (review.foundSubmit) {
        return {
          reachedSubmit: true,
          continueClicks,
          resumeUploaded,
          finalUrl: page.url(),
          hasValidation: false,
        };
      }
    }

    if (await isIndeedSmartApplyReadyToSubmit(page)) {
      await scrollIndeedSmartApplyToActions(page);
      return {
        reachedSubmit: true,
        continueClicks,
        resumeUploaded,
        finalUrl: page.url(),
        hasValidation: false,
      };
    }

    const currentUrl = page.url();
    if (currentUrl === lastUrl) {
      stuckOnUrl++;
      if (stuckOnUrl >= 6) break;
    } else {
      lastUrl = currentUrl;
      stuckOnUrl = 0;
    }

    await prepareIndeedSmartApplyStep(page);

    const aiCtx = {
      jobTitle: "",
      company: "",
      jobDescription: "",
      resumeText: opts.resumeText,
      coverLetter: opts.coverLetter,
      profile: opts.profile,
    };

    await fillIndeedEmployerQuestions(
      page,
      opts.screeningAnswers,
      opts.coverLetter,
      aiCtx
    );
    await fillKnownFields(page, opts.coverLetter, opts.profile);

    await completeIndeedScreeningStep(
      page,
      opts.screeningAnswers,
      opts.coverLetter,
      aiCtx,
      10
    );
    await answerScreeningQuestions(
      page,
      opts.screeningAnswers,
      opts.coverLetter,
      aiCtx
    );

    if (await hasVisibleValidationErrors(page)) {
      await completeIndeedScreeningStep(
        page,
        opts.screeningAnswers,
        opts.coverLetter,
        aiCtx,
        6
      );
      if (await hasVisibleValidationErrors(page)) {
        stuckOnUrl = Math.max(0, stuckOnUrl - 1);
        continue;
      }
    }

    if (opts.tryUploadCv && !resumeUploaded && opts.cvPdfPath) {
      resumeUploaded = await uploadCvPdf(page, opts.cvPdfPath);
    }

    try {
      const useResume = page.getByRole("button", {
        name: /use this resume|continue with this resume|select/i,
      });
      if ((await useResume.count()) > 0) {
        await useResume.first().click({ timeout: 5000 });
        await safeWait(page, 800);
      }
    } catch {
      /* ignore */
    }

    if (await isIndeedSubmitVisible(page)) {
      await scrollIndeedSmartApplyToActions(page);
      return {
        reachedSubmit: true,
        continueClicks,
        resumeUploaded,
        finalUrl: page.url(),
        hasValidation: false,
      };
    }

    const continueBtn = page.getByRole("button", { name: /^continue$/i }).last();
    const canContinue =
      (await continueBtn.count()) > 0 &&
      (await continueBtn.isVisible().catch(() => false)) &&
      (await continueBtn.isEnabled().catch(() => true));

    const advanced = canContinue ? await clickIndeedContinue(page) : false;
    if (advanced) {
      continueClicks++;
      await safeWait(page, 1200);
      try {
        await page.waitForURL((url) => url.href !== currentUrl, { timeout: 8000 });
      } catch {
        /* same step */
      }
    } else if (pass >= 2 && !canContinue) {
      break;
    } else if (pass >= opts.maxPasses - 2) {
      break;
    }

    if (await isIndeedSmartApplyReadyToSubmit(page)) {
      return {
        reachedSubmit: true,
        continueClicks,
        resumeUploaded,
        finalUrl: page.url(),
        hasValidation: false,
      };
    }
  }

  const hasValidation = await hasVisibleValidationErrors(page);
  let reachedSubmit = (await isIndeedSmartApplyReadyToSubmit(page)) && !hasValidation;
  if (!reachedSubmit && /review-module|\/review/i.test(page.url())) {
    const review = await finalizeIndeedReviewStep(page, { clickSubmit: false });
    reachedSubmit = review.foundSubmit && !hasValidation;
  }
  return {
    reachedSubmit,
    continueClicks,
    resumeUploaded,
    finalUrl: page.url(),
    hasValidation,
  };
}
