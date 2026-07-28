import type { IndeedBrowserLoginStatusDto } from "@jobfinder/shared";
import { getProfile, updateProfile } from "../profile.js";
import {
  hasIndeedAuthCookieInProfile,
  hasIndeedCloudflareAccessInProfile,
} from "./browserLoginCookies.js";
import { getIndeedCloudflareStatus, markIndeedCloudflareAccessSaved } from "./indeedCloudflare.js";

export { hasIndeedAuthCookieInProfile };

export async function markIndeedBrowserLoginSaved(): Promise<void> {
  if (!hasIndeedAuthCookieInProfile()) return;
  const profile = await getProfile();
  if (profile.application.indeedBrowserLoginAt) return;
  await updateProfile({
    application: {
      ...profile.application,
      indeedBrowserLoginAt: new Date().toISOString(),
    },
  });
}

export async function getIndeedBrowserLoginStatus(): Promise<IndeedBrowserLoginStatusDto> {
  const profile = await getProfile();
  const cookieReady = hasIndeedAuthCookieInProfile();

  if (cookieReady && !profile.application.indeedBrowserLoginAt) {
    await markIndeedBrowserLoginSaved();
  }

  let { cloudflareReady, cloudflareUnlockedAt } = await getIndeedCloudflareStatus();
  if (!cloudflareReady && hasIndeedCloudflareAccessInProfile()) {
    cloudflareUnlockedAt = await markIndeedCloudflareAccessSaved();
    cloudflareReady = true;
  }

  const refreshed = cookieReady ? await getProfile() : profile;

  return {
    ready: cookieReady,
    savedAt: cookieReady ? refreshed.application.indeedBrowserLoginAt : undefined,
    cloudflareReady,
    cloudflareUnlockedAt,
  };
}
