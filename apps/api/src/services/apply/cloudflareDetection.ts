import type { Frame, Page } from "playwright";
import { hasCaptchaSolverConfigured, solveTurnstileWithApi } from "./captchaSolvers.js";

export type SolveCloudflareOptions = {
  /** Reload this URL after Cloudflare clears (e.g. Indeed viewjob link). */
  targetUrl?: string;
};

export async function hasCfClearanceCookie(page: Page): Promise<boolean> {
  try {
    const cookies = await page.context().cookies();
    return cookies.some((c) => c.name === "cf_clearance" && c.value.length > 10);
  } catch {
    return false;
  }
}

/** Indeed homepage loaded (search box visible). */
export async function isIndeedHomeReady(page: Page): Promise<boolean> {
  try {
    if (!/indeed\.com/i.test(page.url())) return false;
    if (/verification|challenge/i.test(page.url())) return false;
    const title = await page.title();
    if (/additional verification required/i.test(title)) return false;
    const search = page.locator(
      '#text-input-what, input[name="q"], [id="text-input-what"], .yosegi-InlineWhatWhere-primaryField'
    );
    return (await search.count()) > 0;
  } catch {
    return false;
  }
}

/** Indeed job page is actually loaded (not stuck on verification interstitial). */
export async function isIndeedJobPageReady(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (!/indeed\.com/i.test(url) || /verification|challenge/i.test(url)) {
      return false;
    }
    if (/smartapply\.indeed\.com/i.test(url)) return true;

    const applyWithIndeed = page.getByRole("button", { name: /apply with indeed/i }).or(
      page.getByRole("link", { name: /apply with indeed/i })
    );
    if ((await applyWithIndeed.count()) > 0) return true;

    const companyApply = page.getByRole("button", { name: /apply on company site/i });
    if ((await companyApply.count()) > 0) return true;

    const container = page.locator("#applyButtonLinkContainer button, [data-testid='applyButton']");
    return (await container.count()) > 0;
  } catch {
    return false;
  }
}

/** Cloudflare Turnstile / "Additional Verification Required" interstitial. */
export async function isCloudflareChallengePage(page: Page): Promise<boolean> {
  try {
    if (await hasCfClearanceCookie(page)) {
      if (await isIndeedJobPageReady(page)) return false;
    }

    if (await isIndeedJobPageReady(page)) return false;
    if (/smartapply\.indeed\.com/i.test(page.url())) return false;

    const url = page.url();
    if (/challenges\.cloudflare\.com/i.test(url)) return true;

    const title = await page.title();
    if (/additional verification required|just a moment|attention required/i.test(title)) {
      return true;
    }

    const body = await page
      .locator("body")
      .innerText({ timeout: 4000 })
      .catch(() => "");
    const sample = `${title}\n${body}`.slice(0, 4000);
    if (/verify you are human/i.test(sample) && /cloudflare/i.test(sample)) {
      return true;
    }
    if (/additional verification required/i.test(sample) && /ray id/i.test(sample)) {
      return true;
    }

    const turnstile = page.locator(
      'iframe[src*="challenges.cloudflare"], [id*="turnstile"], .cf-turnstile, input[name="cf-turnstile-response"]'
    );
    if ((await turnstile.count()) > 0 && /verification|cloudflare/i.test(sample)) {
      return true;
    }
  } catch {
    /* page closing */
  }
  return false;
}

export class CloudflareChallengeError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "Cloudflare did not clear in time. Install Google Chrome, or add CAPSOLVER_API_KEY to .env for automatic Turnstile solving."
    );
    this.name = "CloudflareChallengeError";
  }
}

async function clickTurnstileInFrame(frame: Frame): Promise<void> {
  const selectors = [
    "input[type='checkbox']",
    "[role='checkbox']",
    ".ctp-checkbox-label",
    ".mark",
    "label",
    "#challenge-stage",
  ];
  for (const sel of selectors) {
    try {
      const loc = frame.locator(sel).first();
      if ((await loc.count()) > 0) {
        await loc.click({ timeout: 4000, force: true });
        return;
      }
    } catch {
      /* try next */
    }
  }
  try {
    await frame.locator("body").click({ position: { x: 28, y: 28 }, force: true, timeout: 3000 });
  } catch {
    /* ignore */
  }
}

/** Click the Turnstile widget once. */
export async function tryClickCloudflareTurnstile(page: Page): Promise<void> {
  const iframeSelectors = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[title*="Widget"]',
    'iframe[title*="challenge"]',
  ];

  for (const sel of iframeSelectors) {
    try {
      const fl = page.frameLocator(sel).first();
      await fl
        .locator("input[type='checkbox'], [role='checkbox'], .ctp-checkbox-label, label, body")
        .first()
        .click({ timeout: 5000, force: true });
    } catch {
      /* try next */
    }
  }

  for (const frame of page.frames()) {
    if (/cloudflare|turnstile/i.test(frame.url())) {
      await clickTurnstileInFrame(frame);
    }
  }

  try {
    await page
      .locator(".cf-turnstile, [data-sitekey], #turnstile-wrapper, #cf-turnstile")
      .first()
      .click({ timeout: 4000, force: true });
  } catch {
    /* ignore */
  }
}

async function trySubmitCloudflareChallengeForm(page: Page): Promise<void> {
  const tokenLen = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
    return el?.value?.length ?? 0;
  });
  if (tokenLen < 10) return;

  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(
      '#challenge-form, form[action*="challenge"], form[id*="challenge"], form'
    );
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  });
}

async function tryClickReturnHome(page: Page): Promise<void> {
  try {
    const home = page
      .getByRole("link", { name: /return home/i })
      .or(page.getByRole("button", { name: /return home/i }));
    if ((await home.count()) > 0) {
      await home.first().click({ timeout: 8000 });
      await page.waitForTimeout(2000);
    }
  } catch {
    /* ignore */
  }
}

async function reloadTargetAfterClearance(page: Page, targetUrl: string): Promise<void> {
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) return;
  try {
    const current = page.url();
    if (await isIndeedJobPageReady(page) && current.includes("viewjob")) return;
    console.log("[cloudflare] Reloading target after clearance:", targetUrl);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.warn("[cloudflare] reload failed:", err instanceof Error ? err.message : err);
  }
}

async function waitForPageClearance(
  page: Page,
  targetUrl?: string,
  timeoutMs = 180_000
): Promise<boolean> {
  if (await tryApiTurnstileSolve(page, targetUrl)) return true;

  const deadline = Date.now() + timeoutMs;
  let lastClick = 0;
  let submittedForm = false;
  let apiAttempted = false;

  while (Date.now() < deadline) {
    if (await isIndeedJobPageReady(page)) return true;
    if (await isIndeedHomeReady(page) && (!targetUrl || targetUrl === "https://ie.indeed.com/")) {
      return true;
    }

    if (await hasCfClearanceCookie(page)) {
      if (targetUrl) await reloadTargetAfterClearance(page, targetUrl);
      if ((await isIndeedJobPageReady(page)) || (await isIndeedHomeReady(page))) return true;
    }

    const tokenLen = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
      return el?.value?.length ?? 0;
    });
    if (tokenLen > 20 && !submittedForm) {
      submittedForm = true;
      await trySubmitCloudflareChallengeForm(page);
      await page.waitForTimeout(4000);
      await tryClickReturnHome(page);
      if (targetUrl) await reloadTargetAfterClearance(page, targetUrl);
      if ((await isIndeedJobPageReady(page)) || (await isIndeedHomeReady(page))) return true;
    }

    if (!(await isCloudflareChallengePage(page))) {
      if (targetUrl) await reloadTargetAfterClearance(page, targetUrl);
      return (
        (await isIndeedJobPageReady(page)) ||
        (await isIndeedHomeReady(page)) ||
        !/verification required/i.test(await page.title())
      );
    }

    if (!apiAttempted && Date.now() > deadline - timeoutMs + 25_000) {
      apiAttempted = true;
      if (await tryApiTurnstileSolve(page, targetUrl)) return true;
    }

    if (Date.now() - lastClick > 8000) {
      lastClick = Date.now();
      await tryClickCloudflareTurnstile(page);
      await page.waitForTimeout(8000);
    }

    await page.waitForTimeout(2000);
  }

  if (await tryApiTurnstileSolve(page, targetUrl)) return true;

  return (
    (await isIndeedJobPageReady(page)) ||
    (await isIndeedHomeReady(page)) ||
    !(await isCloudflareChallengePage(page))
  );
}

async function tryApiTurnstileSolve(page: Page, targetUrl?: string): Promise<boolean> {
  if (!hasCaptchaSolverConfigured()) return false;
  const goal = targetUrl ?? page.url();
  const ok = await solveTurnstileWithApi(page, goal);
  if (!ok) return false;
  await tryClickReturnHome(page);
  if (targetUrl) await reloadTargetAfterClearance(page, targetUrl);
  return (await isIndeedJobPageReady(page)) || (await isIndeedHomeReady(page)) || !(await isCloudflareChallengePage(page));
}

/**
 * Auto-click Turnstile, wait for cf_clearance / Indeed job page, reload target URL.
 */
export async function solveCloudflareChallenge(
  pages: Page[],
  timeoutMs = 180_000,
  options?: SolveCloudflareOptions
): Promise<boolean> {
  const targetUrl = options?.targetUrl;

  for (const p of pages) {
    if (p.isClosed()) continue;

    if (
      !(await isCloudflareChallengePage(p)) &&
      ((await isIndeedJobPageReady(p)) || (await isIndeedHomeReady(p)))
    ) {
      continue;
    }

    console.log("[cloudflare] Solving challenge…", p.url());
    const cleared = await waitForPageClearance(p, targetUrl, timeoutMs);

    if (!cleared && (await isCloudflareChallengePage(p))) {
      return false;
    }
  }

  return true;
}

export async function waitForCloudflareClearance(
  pages: Page[],
  timeoutMs = 300_000,
  options?: SolveCloudflareOptions
): Promise<boolean> {
  return solveCloudflareChallenge(pages, timeoutMs, options);
}
