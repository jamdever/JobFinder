import fs from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import { env, ensureDirs } from "../../config.js";
import {
  AUTOMATION_USER_AGENT,
  launchPersistentAutomationContext,
} from "./browserLaunch.js";

export { AUTOMATION_USER_AGENT };

import type { ApplyBrowserLoginPlatform } from "@jobfinder/shared";
import { markIndeedBrowserLoginSaved } from "./indeedLogin.js";
import { markLinkedInBrowserLoginSaved } from "./linkedinLogin.js";
import { acquireAutomationBrowserLock, isAutomationBrowserBusy } from "./browserLock.js";

const INDEED_LOGIN_URL = "https://secure.indeed.com/auth";
const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";

const PROFILE_DIR = path.join(env.projectRoot, "data", "browser-profile");

export function getBrowserProfileDir(): string {
  ensureDirs();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  return PROFILE_DIR;
}

export async function launchAutomationContext(headless: boolean): Promise<{
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}> {
  const releaseLock = await acquireAutomationBrowserLock();

  try {
    const userDataDir = getBrowserProfileDir();
    const context = await launchPersistentAutomationContext(userDataDir, headless);
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      context,
      page,
      close: async () => {
        try {
          await context.close();
        } finally {
          releaseLock();
        }
      },
    };
  } catch (err) {
    releaseLock();
    throw err;
  }
}

/**
 * Run Playwright with the saved apply profile (LinkedIn + Indeed cookies).
 * Falls back to a one-off browser if Auto Apply already holds the profile lock.
 */
export async function runWithSharedBrowserProfile<T>(
  headless: boolean,
  run: (page: Page) => Promise<T>
): Promise<T> {
  if (isAutomationBrowserBusy()) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless });
    try {
      const page = await browser.newPage({ userAgent: AUTOMATION_USER_AGENT });
      return await run(page);
    } finally {
      await browser.close();
    }
  }

  const { page, close } = await launchAutomationContext(headless);
  try {
    return await run(page);
  } finally {
    await close();
  }
}

function wireContextClose(context: BrowserContext, onClose: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onClose();
  };
  context.on("close", finish);
}

/** Open browser to sign in (same profile dir as Auto Apply). */
export async function openBrowserForManualLogin(
  platform: ApplyBrowserLoginPlatform = "both"
): Promise<{
  message: string;
  profileDir: string;
}> {
  if (isAutomationBrowserBusy()) {
    throw new Error("Auto Apply is using the browser. Wait for it to finish, then set up login.");
  }

  const releaseLock = await acquireAutomationBrowserLock();
  const userDataDir = getBrowserProfileDir();

  let context: BrowserContext;
  try {
    context = await launchPersistentAutomationContext(userDataDir, false);
  } catch (err) {
    releaseLock();
    throw err;
  }

  const page = context.pages()[0] ?? (await context.newPage());

  const openLinkedIn = platform === "linkedin" || platform === "both";
  const openIndeed = platform === "indeed" || platform === "both";

  const finish = async () => {
    try {
      if (openIndeed) await markIndeedBrowserLoginSaved();
      if (openLinkedIn) await markLinkedInBrowserLoginSaved();
    } catch {
      /* profile update optional */
    }
    try {
      await context.close();
    } finally {
      releaseLock();
    }
  };

  wireContextClose(context, () => {
    void finish();
  });

  const loginTimeout = setTimeout(() => {
    void finish();
  }, 5 * 60 * 1000);
  loginTimeout.unref?.();

  try {
    if (openLinkedIn && openIndeed) {
      await page.goto(INDEED_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const linkedInTab = await context.newPage();
      await linkedInTab.goto(LINKEDIN_LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await linkedInTab.bringToFront();
    } else if (openLinkedIn) {
      await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } else {
      await page.goto(INDEED_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    await page.bringToFront();
  } catch (err) {
    clearTimeout(loginTimeout);
    await finish();
    throw err;
  }

  const message =
    platform === "linkedin"
      ? "Browser opened on LinkedIn login. Sign in there (not Chrome/Edge). Close the window when done — session is saved for Apply."
      : platform === "indeed"
        ? "Browser opened on Indeed login. Sign in there (not Chrome/Edge). Close the window when done — session is saved for Apply."
        : "Browser opened with Indeed and LinkedIn tabs. Sign in on both, then close the window when done.";

  return { message, profileDir: userDataDir };
}

/** Open a URL in the saved automation browser profile (uses LinkedIn login from setup). */
export async function openUrlInAutomationBrowser(url: string): Promise<{
  message: string;
  profileDir: string;
}> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Invalid URL");
  }

  if (isAutomationBrowserBusy()) {
    throw new Error(
      "The apply browser is already open (login setup or Auto Apply). Close that window, wait a few seconds, then try Apply again."
    );
  }

  const releaseLock = await acquireAutomationBrowserLock();
  const userDataDir = getBrowserProfileDir();

  let context: BrowserContext;
  try {
    context = await launchPersistentAutomationContext(userDataDir, false);
  } catch (err) {
    releaseLock();
    const msg = err instanceof Error ? err.message : String(err);
    if (/user data directory|already in use|profile/i.test(msg)) {
      throw new Error(
        "Could not open the apply browser — another Chrome window may be using the same profile. Close all apply-browser windows and try again."
      );
    }
    throw err;
  }

  const page = context.pages()[0] ?? (await context.newPage());

  wireContextClose(context, releaseLock);

  void page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 })
    .then(() => page.bringToFront())
    .catch(() => {
      /* window is open; user can refresh or sign in */
    });

  return {
    message: "Apply browser opened — loading the job page. Check for a Chrome/Chromium window (it may be behind other apps).",
    profileDir: userDataDir,
  };
}
