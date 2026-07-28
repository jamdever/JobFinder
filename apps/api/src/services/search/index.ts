import type { JobListingInput, UserProfile } from "@jobfinder/shared";
import { setCollectProgress } from "../collectProgress.js";
import { fetchIndeedJobsDetailed, type IndeedFetchResult } from "./indeed.js";
import { fetchLinkedInJobsBatch } from "./linkedin.js";
import { dedupeListings } from "../jobDedup.js";
import { runWithConcurrency } from "./concurrency.js";
import {
  filterByPostedAge,
  filterListingsBySearchArea,
  getMaxPostedDays,
  getSearchCountiesFromProfile,
  getSearchTitles,
  profileWithSearchScope,
} from "./utils.js";

export interface SearchSourceResult {
  source: string;
  count: number;
  warning?: string;
}

export interface SearchAllResult {
  listings: JobListingInput[];
  bySource: SearchSourceResult[];
  linkedInExternalUrls?: string[];
}

export interface SearchCollectOptions {
  linkedInEasyApplyOnly?: boolean;
}

export async function searchAll(profile: UserProfile): Promise<JobListingInput[]> {
  const { listings } = await searchAllDetailed(profile);
  return listings;
}

/** One Indeed run per county (all titles in query), not per title×county. */
async function fetchIndeedBoard(profile: UserProfile): Promise<IndeedFetchResult> {
  const counties = getSearchCountiesFromProfile(profile);
  const countyScopes = counties.length > 0 ? counties : [""];
  const primaryTitle = getSearchTitles(profile)[0] ?? "software developer";

  if (countyScopes.length <= 1) {
    const scoped = profileWithSearchScope(profile, primaryTitle, countyScopes[0] ?? "");
    return fetchIndeedJobsDetailed(scoped);
  }

  const allJobs: JobListingInput[] = [];
  let warning: string | undefined;
  const batches = await runWithConcurrency(countyScopes, 2, async (county) => {
    const scoped = profileWithSearchScope(profile, primaryTitle, county);
    return fetchIndeedJobsDetailed(scoped);
  });
  for (const batch of batches) {
    allJobs.push(...batch.jobs);
    if (batch.warning) warning = batch.warning;
  }
  return { jobs: dedupeListings(allJobs), warning };
}

export async function searchAllDetailed(
  profile: UserProfile,
  collectOptions?: SearchCollectOptions
): Promise<SearchAllResult> {
  const started = Date.now();
  const sources = new Set(
    profile.search.sources
      .map((s) => s.toLowerCase())
      .filter((s) => s !== "jobsie" && s !== "jobs.ie")
  );
  const titles = getSearchTitles(profile);
  const counties = getSearchCountiesFromProfile(profile);
  const countyScopes = counties.length > 0 ? counties : [""];

  const linkedInScopes =
    sources.has("linkedin") ?
      titles.flatMap((title) =>
        countyScopes.map((county) => profileWithSearchScope(profile, title, county))
      )
    : [];

  const useIndeed = sources.has("indeed");

  console.log(
    `[collect] boards: linkedin=${sources.has("linkedin") ? linkedInScopes.length : 0} scope(s), indeed=${useIndeed ? countyScopes.length : 0} county run(s)`
  );

  setCollectProgress({
    percent: 8,
    stage: "searching",
    message: "Searching job boards…",
  });

  const [linkedInResults, indeedResult] = await Promise.all([
    sources.has("linkedin")
      ? fetchLinkedInJobsBatch(linkedInScopes, {
          easyApplyOnly: collectOptions?.linkedInEasyApplyOnly,
          onProgress: ({ done, total, title }) => {
            const pct = 10 + Math.round((done / Math.max(total, 1)) * 45);
            setCollectProgress({
              percent: pct,
              stage: "linkedin",
              message: title
                ? `LinkedIn: searching “${title}” (${done}/${total})…`
                : `LinkedIn: ${done}/${total} searches…`,
            });
          },
        })
      : Promise.resolve([]),
    useIndeed
      ? fetchIndeedBoard(profile).then((result) => {
          setCollectProgress({
            percent: 55,
            stage: "indeed",
            message: "Indeed search finished…",
          });
          return result;
        })
      : Promise.resolve({ jobs: [] as JobListingInput[] } as IndeedFetchResult),
  ]);

  setCollectProgress({
    percent: 62,
    stage: "filtering",
    message: "Filtering and deduplicating results…",
  });

  const listings: JobListingInput[] = [...indeedResult.jobs];
  const warnings = new Map<string, string>();
  if (indeedResult.warning) warnings.set("indeed", indeedResult.warning);

  const linkedInExternalUrls: string[] = [];
  for (const { jobs, warning, externalUrls } of linkedInResults) {
    listings.push(...jobs);
    if (externalUrls?.length) linkedInExternalUrls.push(...externalUrls);
    if (warning) warnings.set("linkedin", warning);
  }

  const unique = dedupeListings(listings);
  const byArea = filterListingsBySearchArea(unique, profile);
  const filtered = filterByPostedAge(byArea, getMaxPostedDays(profile));

  console.log(`[collect] search finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const bySource: SearchSourceResult[] = [];
  if (useIndeed) {
    bySource.push({
      source: "indeed",
      count: filtered.filter((j) => j.source === "indeed").length,
      warning: warnings.get("indeed"),
    });
  }
  if (sources.has("linkedin")) {
    bySource.push({
      source: "linkedin",
      count: filtered.filter((j) => j.source === "linkedin").length,
      warning: warnings.get("linkedin"),
    });
  }

  return {
    listings: filtered,
    bySource,
    linkedInExternalUrls:
      linkedInExternalUrls.length > 0 ? [...new Set(linkedInExternalUrls)] : undefined,
  };
}
