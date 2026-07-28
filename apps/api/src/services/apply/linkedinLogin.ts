import type { LinkedInBrowserLoginStatusDto } from "@jobfinder/shared";
import { getProfile, updateProfile } from "../profile.js";
import { hasLinkedInAuthCookieInProfile } from "./browserLoginCookies.js";

export { hasLinkedInAuthCookieInProfile };

export async function markLinkedInBrowserLoginSaved(): Promise<void> {
  if (!hasLinkedInAuthCookieInProfile()) return;
  const profile = await getProfile();
  if (profile.application.linkedInBrowserLoginAt) return;
  await updateProfile({
    application: {
      ...profile.application,
      linkedInBrowserLoginAt: new Date().toISOString(),
    },
  });
}

export async function getLinkedInBrowserLoginStatus(): Promise<LinkedInBrowserLoginStatusDto> {
  const profile = await getProfile();
  const cookieReady = hasLinkedInAuthCookieInProfile();

  if (cookieReady && !profile.application.linkedInBrowserLoginAt) {
    await markLinkedInBrowserLoginSaved();
  }

  const refreshed = cookieReady ? await getProfile() : profile;

  return {
    ready: cookieReady,
    savedAt: cookieReady ? refreshed.application.linkedInBrowserLoginAt : undefined,
  };
}
