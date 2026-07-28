import type { UserProfile } from "@jobfinder/shared";

export function isSearchConfigured(profile: UserProfile): boolean {
  const hasTitle = profile.preferences.titles.some((t) => t.trim().length > 0);
  const hasSource = profile.search.sources.length > 0;
  return hasTitle && hasSource;
}
