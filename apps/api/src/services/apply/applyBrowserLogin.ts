import type { ApplyBrowserLoginStatusDto } from "@jobfinder/shared";
import { getIndeedBrowserLoginStatus } from "./indeedLogin.js";
import { getLinkedInBrowserLoginStatus } from "./linkedinLogin.js";

export async function getApplyBrowserLoginStatus(): Promise<ApplyBrowserLoginStatusDto> {
  const [linkedIn, indeed] = await Promise.all([
    getLinkedInBrowserLoginStatus(),
    getIndeedBrowserLoginStatus(),
  ]);
  return { linkedIn, indeed };
}

export function isIndeedJobUrl(url: string): boolean {
  return /indeed\.com/i.test(url);
}

export function isLinkedInJobUrl(url: string): boolean {
  return /linkedin\.com\/jobs/i.test(url);
}
