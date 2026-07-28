import type { JobListingInput, UserProfile } from "@jobfinder/shared";

import {

  buildPreferenceLocations,

  DEFAULT_SEARCH_COUNTRY,

  getBoardSearchLocation,

  getSearchCounties,

  jobLocationMatchesSearchCounties,

  normalizeCounty,

} from "@jobfinder/shared";



/** Unique, non-empty job titles from profile (at least one default). */

export function getSearchTitles(profile: UserProfile): string[] {

  const seen = new Set<string>();

  const titles: string[] = [];

  for (const raw of profile.preferences.titles) {

    const t = raw.trim();

    if (!t) continue;

    const key = t.toLowerCase();

    if (seen.has(key)) continue;

    seen.add(key);

    titles.push(t);

  }

  return titles.length > 0 ? titles : ["Junior Software Developer"];

}



export function getSearchCountiesFromProfile(profile: UserProfile): string[] {

  return getSearchCounties(profile.search.counties, profile.search.county);

}



export function profileWithSearchTitle(profile: UserProfile, title: string): UserProfile {

  return {

    ...profile,

    preferences: { ...profile.preferences, titles: [title] },

  };

}



/** Scope profile to one title + one county for a single board query. */

export function profileWithSearchScope(

  profile: UserProfile,

  title: string,

  county: string

): UserProfile {

  const c = normalizeCounty(county);

  return {

    ...profile,

    preferences: { ...profile.preferences, titles: [title] },

    search: {

      ...profile.search,

      county: c,

      counties: c ? [c] : [],

    },

  };

}



export function getSearchQuery(profile: UserProfile): string {

  return getSearchTitles(profile)[0] ?? "Junior Software Developer";

}

/**
 * Indeed.ie works best with short queries (e.g. "software developer"), not many long exact titles.
 * Returns a few complementary queries so graduate/junior/associate roles still get hits.
 */
export function getIndeedSearchQueries(profile: UserProfile): string[] {
  const titles = getSearchTitles(profile);
  const queries = new Set<string>();

  const softwareish = (t: string) =>
    /\b(software|developer|engineer|programmer|fullstack|full[\s-]?stack|frontend|front[\s-]?end|backend|back[\s-]?end|\.net|embedded|application)\b/i.test(
      t
    );
  const levelish = (t: string) =>
    /\b(graduate|junior|associate|entry[\s-]?level|intern)\b/i.test(t);

  const softTitles = titles.filter(softwareish);
  const leveled = softTitles.filter(levelish);

  if (leveled.length > 0 || (softTitles.length > 0 && titles.some(levelish))) {
    queries.add("graduate software developer");
    queries.add("graduate software engineer");
    queries.add("junior software developer");
    queries.add("software developer");
  } else if (softTitles.length > 0) {
    queries.add("software developer");
    queries.add("software engineer");
    for (const t of softTitles.slice(0, 2)) {
      queries.add(t.trim());
    }
  } else {
    for (const t of titles.slice(0, 3)) {
      const cleaned = t.trim();
      if (cleaned) queries.add(cleaned);
    }
  }

  if (queries.size === 0) {
    queries.add(getSearchQuery(profile));
  }

  return [...queries].slice(0, 4);
}

/** @deprecated Prefer getIndeedSearchQueries — kept for single-query callers. */
export function getIndeedSearchQuery(profile: UserProfile): string {
  return getIndeedSearchQueries(profile)[0] ?? getSearchQuery(profile);
}

/** Exact phrase for job board search APIs (non-Indeed). */

export function getExactSearchQuery(profile: UserProfile): string {

  const title = getSearchQuery(profile);

  return `"${title}"`;

}



export function getMaxPostedDays(profile: UserProfile): number {

  return profile.preferences.maxPostedDays ?? 7;

}



export function getSearchCountry(profile: UserProfile): string {

  return profile.search.country?.trim() || DEFAULT_SEARCH_COUNTRY;

}



/** @deprecated use getSearchCountiesFromProfile */

export function getSearchCounty(profile: UserProfile): string {

  return getSearchCountiesFromProfile(profile)[0] ?? "";

}



/** Location string passed to job boards (e.g. "Cork, Ireland" or "Ireland"). */

export function getSearchLocation(profile: UserProfile): string {

  return getBoardSearchLocation(getSearchCountry(profile), profile.search.county);

}



export function withSyncedSearchLocations(profile: UserProfile): UserProfile {

  const country = getSearchCountry(profile);

  const counties = getSearchCountiesFromProfile(profile);

  return {

    ...profile,

    search: {

      ...profile.search,

      country,

      counties,

      county: counties[0] ?? "",

    },

    preferences: {

      ...profile.preferences,

      locations: buildPreferenceLocations(country, counties),

    },

  };

}



/** Narrow nationwide board results to the selected counties when possible. */

export function filterListingsBySearchArea(

  listings: JobListingInput[],

  profile: UserProfile

): JobListingInput[] {

  const counties = getSearchCountiesFromProfile(profile);

  if (counties.length === 0) return listings;



  return listings.filter((job) =>

    jobLocationMatchesSearchCounties(counties, job.location, "board")

  );

}



export function jobMatchesSearchArea(

  profile: UserProfile,

  location: string | undefined,

  mode: "strict" | "board" = "strict"

): boolean {

  return jobLocationMatchesSearchCounties(

    getSearchCountiesFromProfile(profile),

    location,

    mode

  );

}



export function filterByPostedAge(

  listings: JobListingInput[],

  maxDays: number

): JobListingInput[] {

  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;

  return listings.filter((job) => {

    if (!job.postedAt) return true;

    const posted = new Date(job.postedAt).getTime();

    return !Number.isNaN(posted) && posted >= cutoff;

  });

}



export function slugify(text: string): string {

  return text

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, "-")

    .replace(/^-|-$/g, "");

}



export function jobsIeSlug(title: string): string {

  return title

    .toLowerCase()

    .split(/\s+/)

    .join(",");

}


