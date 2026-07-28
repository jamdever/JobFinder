import type { UserProfile } from "@jobfinder/shared";
import { getMaxPostedDays, getSearchLocation, getSearchQuery } from "./utils.js";

function linkedInTimeFilter(maxDays: number): string {
  if (maxDays <= 1) return "r86400";
  if (maxDays <= 7) return "r604800";
  if (maxDays <= 30) return "r2592000";
  return "";
}

export type LinkedInSearchUrlOptions = { easyApplyOnly?: boolean };

export function buildLinkedInSearchUrl(
  profile: UserProfile,
  options?: LinkedInSearchUrlOptions
): string {
  const params = new URLSearchParams({
    keywords: getSearchQuery(profile),
    location: getSearchLocation(profile),
  });
  if (options?.easyApplyOnly) params.set("f_AL", "true");
  const timeFilter = linkedInTimeFilter(getMaxPostedDays(profile));
  if (timeFilter) params.set("f_TPR", timeFilter);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}
