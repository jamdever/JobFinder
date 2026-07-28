import type { Page } from "playwright";

const AUTH_URL_PATTERNS = [
  /accounts\.google\.com/i,
  /google\.com\/signin/i,
  /login\.microsoftonline\.com/i,
  /login\.live\.com/i,
  /linkedin\.com\/(login|uas\/login|checkpoint)/i,
  /secure\.indeed\.com/i,
  /auth\.indeed\.com/i,
  /auth0\.com/i,
  /okta\.com/i,
  /sso\./i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/login\b/i,
];

const AUTH_TITLE_PATTERNS = [/sign in/i, /log in/i, /sign in with google/i];

export function isAuthUrl(url: string): boolean {
  return AUTH_URL_PATTERNS.some((p) => p.test(url));
}

export function isAuthPage(page: Page): boolean {
  const url = page.url();
  if (isAuthUrl(url)) return true;
  return false;
}

export async function isAuthPageDeep(page: Page): Promise<boolean> {
  if (isAuthPage(page)) return true;
  try {
    const title = await page.title();
    if (AUTH_TITLE_PATTERNS.some((p) => p.test(title))) {
      if (isAuthUrl(page.url()) || (await page.locator('input[type="password"]').count()) > 0) {
        return true;
      }
    }
    if ((await page.locator('input[type="email"], input[name="identifier"]').count()) > 0) {
      const pwd = await page.locator('input[type="password"]').count();
      if (pwd > 0 && /google|microsoft|linkedin|sign in|log in/i.test(page.url() + title)) {
        return true;
      }
    }
  } catch {
    /* page may be closing */
  }
  return false;
}

export class AuthRequiredError extends Error {
  readonly pages: string[];

  constructor(pages: string[]) {
    super(
      "Sign-in required. Log in once using Set up apply browser login (Indeed and/or LinkedIn), then run again."
    );
    this.name = "AuthRequiredError";
    this.pages = pages;
  }
}

/** In headed mode, wait for user to finish login on any open page. */
export async function waitForUserLogin(
  pages: Page[],
  timeoutMs = 180_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const authPages = [];
    for (const p of pages) {
      try {
        if (!p.isClosed() && (await isAuthPageDeep(p))) authPages.push(p);
      } catch {
        /* closed */
      }
    }
    if (authPages.length === 0) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export async function collectOpenPages(root: Page): Promise<Page[]> {
  const context = root.context();
  return context.pages().filter((p) => !p.isClosed());
}
