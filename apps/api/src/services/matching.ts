import type { JobListingInput, UserProfile } from "@jobfinder/shared";
import { getSearchTitles, jobMatchesSearchArea } from "./search/utils.js";
import {
  isRelevantJobTitle,
  isSeniorOrStaffJobTitle,
  scoreTitleRelevance,
  targetIsJunior,
} from "./titleMatch.js";

export function bestTitleRelevance(profile: UserProfile, jobTitle: string): number {
  const titles = getSearchTitles(profile);
  let best = 0;
  for (const target of titles) {
    best = Math.max(best, scoreTitleRelevance(target, jobTitle));
  }
  return best;
}

export function matchesAnyTargetTitle(profile: UserProfile, jobTitle: string): boolean {
  const titles = getSearchTitles(profile);
  const min = profile.preferences.minMatchScore ?? 0.55;

  const hasJuniorTarget = titles.some(targetIsJunior);
  const hasExplicitSeniorTarget = titles.some((t) => isSeniorOrStaffJobTitle(t));

  if (
    hasJuniorTarget &&
    !hasExplicitSeniorTarget &&
    isSeniorOrStaffJobTitle(jobTitle)
  ) {
    return false;
  }

  return titles.some((target) => isRelevantJobTitle(target, jobTitle, min));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function scoreJob(listing: JobListingInput & { tags?: string[] }, profile: UserProfile): number {
  const prefs = profile.preferences;
  const titles = getSearchTitles(profile);
  const titleRelevance = titles.length ? bestTitleRelevance(profile, listing.title) : 0;

  if (titles.length && titleRelevance < 0.35) return 0;

  const blob = normalize(
    [listing.title, listing.company, listing.location, listing.description, ...(listing.tags ?? [])].join(
      " "
    )
  );

  for (const bad of prefs.excludeKeywords) {
    if (blob.includes(normalize(bad))) return 0;
  }

  let locationScore = 0;
  if (prefs.locations.length) {
    if (
      jobMatchesSearchArea(profile, listing.location, "board") ||
      prefs.locations.some((loc) => blob.includes(normalize(loc)))
    ) {
      locationScore = 1;
    }
  } else {
    locationScore = 1;
  }

  const combined = titleRelevance * 0.85 + locationScore * 0.15;
  return Math.round(combined * 1000) / 1000;
}

export function passesThreshold(matchScore: number, profile: UserProfile): boolean {
  const min = profile.preferences.minMatchScore ?? 0.55;
  return matchScore >= min;
}

export function listingMatchesTarget(profile: UserProfile, listing: JobListingInput): boolean {
  if (!getSearchTitles(profile).length) return false;
  if (!matchesAnyTargetTitle(profile, listing.title)) return false;
  if (!jobMatchesSearchArea(profile, listing.location, "board")) return false;
  return passesThreshold(scoreJob(listing, profile), profile);
}
