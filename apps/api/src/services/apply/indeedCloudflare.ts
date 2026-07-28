import type { UnlockIndeedAccessResultDto } from "@jobfinder/shared";
import type { Page } from "playwright";
import { getProfile, updateProfile } from "../profile.js";
import {
  hasIndeedCloudflareAccessInProfile,
} from "./browserLoginCookies.js";
import { hasCaptchaSolverConfigured } from "./captchaSolvers.js";
import {
  hasCfClearanceCookie,
  isIndeedHomeReady,
} from "./cloudflareDetection.js";

export { hasIndeedCloudflareAccessInProfile };

export async function markIndeedCloudflareAccessSaved(): Promise<string> {
  const at = new Date().toISOString();
  const profile = await getProfile();
  await updateProfile({
    application: {
      ...profile.application,
      indeedCloudflareUnlockedAt: at,
    },
  });
  return at;
}

export async function getIndeedCloudflareStatus(): Promise<{
  cloudflareReady: boolean;
  cloudflareUnlockedAt?: string;
}> {
  const profile = await getProfile();
  let cloudflareReady = hasIndeedCloudflareAccessInProfile();
  let cloudflareUnlockedAt = profile.application.indeedCloudflareUnlockedAt;

  if (cloudflareReady && !cloudflareUnlockedAt) {
    cloudflareUnlockedAt = await markIndeedCloudflareAccessSaved();
  }

  return { cloudflareReady, cloudflareUnlockedAt };
}

/** Wait for cookies to flush to the persistent profile before closing the browser. */
export async function persistIndeedBrowserAccess(page: Page): Promise<boolean> {
  await page.waitForTimeout(1500);
  return (await isIndeedHomeReady(page)) || (await hasCfClearanceCookie(page));
}

export function buildUnlockIndeedSuccessMessage(capsolverConfigured: boolean): string {
  if (capsolverConfigured) {
    return "Cloudflare access saved in the apply browser. Scan or dry run should work without the human check.";
  }
  return "Cloudflare access saved in the apply browser. You only need to run this again if Indeed asks you to verify later.";
}

export function toUnlockIndeedResult(
  saved: boolean,
  capsolverConfigured: boolean,
  cloudflareUnlockedAt?: string
): UnlockIndeedAccessResultDto {
  const cloudflareReady = saved || hasIndeedCloudflareAccessInProfile();
  return {
    message: saved
      ? buildUnlockIndeedSuccessMessage(capsolverConfigured)
      : "Could not save Cloudflare access.",
    saved,
    cloudflareReady,
    cloudflareUnlockedAt,
    capsolverConfigured,
  };
}
