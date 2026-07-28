import {
  assertAiConfigured,
  getAiModelLabel,
} from "./ai/llm.js";
import { JobModel } from "../models/Job.js";
import { analyzeJobAgainstCv } from "./ai/matcher.js";
import { listingMatchesTarget, scoreJob } from "./matching.js";
import { getProfile, loadResumeText } from "./profile.js";
import type { UserProfile } from "@jobfinder/shared";
import { cleanupIrrelevantJobs } from "./jobCleanup.js";
import { setCollectProgress } from "./collectProgress.js";
import {
  dedupeListings,
  findExistingJobForListing,
  jobDedupKey,
  mergeDuplicateJobsInDatabase,
  preferRicherLocation,
} from "./jobDedup.js";
import { metadataFromListing } from "./jobMetadata.js";
import { searchAllDetailed, type SearchSourceResult } from "./search/index.js";

export interface CollectJobsOptions {
  linkedInEasyApplyOnly?: boolean;
  /** Collect Indeed jobs for Auto Apply Indeed (tags easy_apply). */
  indeedEasyApplyOnly?: boolean;
}

export async function collectJobs(): Promise<CollectJobsResult> {
  return collectJobsWithProfile(await getProfile());
}

export type CollectJobsResult = {
  found: number;
  eligible: number;
  removed: number;
  duplicatesRemoved: number;
  bySource: SearchSourceResult[];
  jobIds: string[];
};

export async function collectJobsWithProfile(
  profile: UserProfile,
  collectOptions?: CollectJobsOptions
): Promise<CollectJobsResult> {
  if (!profile.preferences.titles.length) {
    throw new Error("Add at least one job title in Job Search settings before collecting.");
  }
  if (!profile.search.sources.length) {
    throw new Error("Select at least one job board in Job Search settings.");
  }
  await JobModel.deleteMany({
    source: "jobsie",
    title: { $regex: /^at least\s*€/i },
  });

  const { getSearchTitles } = await import("./search/utils.js");
  const targetTitles = getSearchTitles(profile);

  const [removed, { listings: searched, bySource, linkedInExternalUrls }] = await Promise.all([
    cleanupIrrelevantJobs(profile),
    searchAllDetailed(profile, {
      linkedInEasyApplyOnly: collectOptions?.linkedInEasyApplyOnly,
    }),
  ]);

  if (collectOptions?.linkedInEasyApplyOnly && linkedInExternalUrls?.length) {
    const demoted = await demoteLinkedInJobsToExternal(linkedInExternalUrls);
    if (demoted > 0) {
      console.log(`[collect] demoted ${demoted} mis-tagged Easy Apply jobs to external`);
    }
  }
  for (const row of bySource) {
    console.log(`[collect] ${row.source}: ${row.count} jobs${row.warning ? ` (${row.warning})` : ""}`);
  }

  const allListings = searched.filter(
    (l) => !/^at least\s*€/i.test(l.title) && l.title.length >= 4
  );
  const matched = allListings.filter((l) => listingMatchesTarget(profile, l));
  let listings = dedupeListings(matched);

  if (collectOptions?.linkedInEasyApplyOnly) {
    const before = listings.length;
    listings = listings.filter((l) => l.linkedInApplyType === "easy_apply");
    if (before > listings.length) {
      console.log(
        `[collect] Easy Apply only: keeping ${listings.length} of ${before} matched listings`
      );
    }
  }
  if (collectOptions?.indeedEasyApplyOnly) {
    const before = listings.length;
    listings = listings.filter((l) => l.source === "indeed");
    if (before > listings.length) {
      console.log(
        `[collect] Indeed Easy Apply collect: keeping ${listings.length} of ${before} matched listings`
      );
    }
  }
  const { getSearchCountiesFromProfile } = await import("./search/utils.js");
  const { formatSearchLocationsLabel } = await import("@jobfinder/shared");
  const counties = getSearchCountiesFromProfile(profile);
  const areaNote =
    counties.length > 0
      ? ` in ${formatSearchLocationsLabel(profile.search.country ?? "Ireland", counties)}`
      : "";
  console.log(
    `[collect] ${allListings.length} raw → ${matched.length} matching "${targetTitles.join(" | ")}"${areaNote} → ${listings.length} after dedup`
  );
  if (allListings.length > 0 && matched.length === 0) {
    console.warn(
      "[collect] Jobs were found on boards but none passed title/location rules. Try removing broad titles or set county to All Ireland."
    );
  }
  const eligible = listings.length;
  const jobIds: string[] = [];

  setCollectProgress({
    percent: 68,
    stage: "saving",
    message:
      eligible > 0
        ? `Saving ${eligible} matching job${eligible === 1 ? "" : "s"}…`
        : "No matching jobs to save…",
  });

  for (const listing of listings) {
    const matchScore = scoreJob(listing, profile);
    const dedupKey = jobDedupKey(listing);
    const meta = metadataFromListing(listing);

    try {
      const existing = await findExistingJobForListing(listing);
      const description =
        (listing.description ?? "").length > (existing?.description?.length ?? 0)
          ? listing.description ?? ""
          : existing?.description ?? listing.description ?? "";

      const update = {
        $set: {
          externalId: listing.externalId,
          source: listing.source,
          title: listing.title,
          company: listing.company,
          location: preferRicherLocation(
            existing?.location ?? "",
            listing.location ?? ""
          ),
          url: listing.url,
          description,
          tags: listing.tags ?? [],
          salary: listing.salary?.trim() ? listing.salary : existing?.salary ?? "",
          matchScore:
            existing?.matchScore != null
              ? Math.max(existing.matchScore, matchScore)
              : matchScore,
          dedupKey,
          workArrangement: meta.workArrangement,
          employmentType: meta.employmentType,
          visaSponsorship: meta.visaSponsorship,
          techStack: meta.techStack,
          salaryMin: meta.salaryMin,
          salaryMax: meta.salaryMax,
          hasSalary: meta.hasSalary,
          linkedInApplyType: resolveStoredLinkedInApplyType(
            listing,
            existing?.linkedInApplyType,
            collectOptions?.linkedInEasyApplyOnly
          ),
          indeedApplyType: resolveStoredIndeedApplyType(
            listing,
            existing?.indeedApplyType,
            collectOptions?.indeedEasyApplyOnly
          ),
          postedAt: listing.postedAt
            ? new Date(listing.postedAt)
            : existing?.postedAt,
        },
        $setOnInsert: {
          status: "discovered" as const,
          discoveredAt: new Date(),
        },
      };

      const doc = existing
        ? await JobModel.findOneAndUpdate({ _id: existing._id }, update, { new: true })
        : await JobModel.findOneAndUpdate({ dedupKey }, update, { upsert: true, new: true });

      if (doc) jobIds.push(doc._id.toString());
    } catch (err) {
      console.warn(`[collect] skipped ${listing.source} ${listing.title}:`, err);
    }
  }

  const duplicatesRemoved = await mergeDuplicateJobsInDatabase();

  const resolvedIds: string[] = [];
  for (const listing of listings) {
    const doc = await findExistingJobForListing(listing);
    if (doc) resolvedIds.push(doc._id.toString());
  }
  const uniqueJobIds = [...new Set(resolvedIds.length > 0 ? resolvedIds : jobIds)];

  return {
    found: listings.length,
    eligible,
    removed,
    duplicatesRemoved,
    bySource,
    jobIds: uniqueJobIds,
  };
}

function resolveStoredLinkedInApplyType(
  listing: { source: string; linkedInApplyType?: string },
  existing: string | null | undefined,
  easyApplyOnlyCollect?: boolean
): string | undefined {
  if (listing.source !== "linkedin") return undefined;
  if (easyApplyOnlyCollect) {
    return listing.linkedInApplyType === "easy_apply" ? "easy_apply" : undefined;
  }
  if (listing.linkedInApplyType && listing.linkedInApplyType !== "unknown") {
    return listing.linkedInApplyType;
  }
  return listing.linkedInApplyType ?? existing ?? undefined;
}

function resolveStoredIndeedApplyType(
  listing: { source: string },
  existing: string | null | undefined,
  easyApplyOnlyCollect?: boolean
): string | undefined {
  if (listing.source !== "indeed") return undefined;
  if (easyApplyOnlyCollect) {
    return "easy_apply";
  }
  return existing ?? undefined;
}

/** Normalize LinkedIn job view URLs for matching stored jobs. */
function linkedInJobUrlKeys(url: string): string[] {
  const trimmed = url.split("?")[0]?.replace(/\/$/, "") ?? url;
  const id = trimmed.match(/(\d{5,})/)?.[1];
  const keys = [trimmed];
  if (id) keys.push(id);
  return keys;
}

async function demoteLinkedInJobsToExternal(urls: string[]): Promise<number> {
  const keys = new Set(urls.flatMap(linkedInJobUrlKeys));
  if (keys.size === 0) return 0;

  const or = [...keys].flatMap((key) => [
    { url: { $regex: key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
  ]);

  const result = await JobModel.updateMany(
    { source: "linkedin", linkedInApplyType: "easy_apply", $or: or },
    { $set: { linkedInApplyType: "external" } }
  );
  return result.modifiedCount;
}

/** Indeed-only collect for Auto Apply Indeed watch. */
export async function collectIndeedEasyApplyJobs(): Promise<{
  found: number;
  eligible: number;
  easyApplyInDb: number;
  indeedOnBoard: number;
  indeedWarning?: string;
  untaggedIndeedInDb: number;
  bySource: SearchSourceResult[];
}> {
  const profile = await getProfile();
  const indeedProfile: UserProfile = {
    ...profile,
    search: { ...profile.search, sources: ["indeed"] },
  };
  const result = await collectJobsWithProfile(indeedProfile, {
    indeedEasyApplyOnly: true,
  });

  const indeedRow = result.bySource.find((r) => r.source === "indeed");

  const [easyApplyInDb, untaggedIndeedInDb] = await Promise.all([
    JobModel.countDocuments({
      source: "indeed",
      indeedApplyType: "easy_apply",
      status: { $nin: ["dismissed"] },
    }),
    JobModel.countDocuments({
      source: "indeed",
      $or: [{ indeedApplyType: { $exists: false } }, { indeedApplyType: null }],
      status: { $nin: ["dismissed"] },
    }),
  ]);
  return {
    found: result.found,
    eligible: result.eligible,
    easyApplyInDb,
    indeedOnBoard: indeedRow?.count ?? 0,
    indeedWarning: indeedRow?.warning,
    untaggedIndeedInDb,
    bySource: result.bySource,
  };
}

/** LinkedIn-only collect for Auto Apply watch (Easy Apply search + tagging). */
export async function collectLinkedInEasyApplyJobs(): Promise<{
  found: number;
  eligible: number;
  easyApplyInDb: number;
  bySource: SearchSourceResult[];
}> {
  const profile = await getProfile();
  const linkedInProfile: UserProfile = {
    ...profile,
    search: { ...profile.search, sources: ["linkedin"] },
  };
  const result = await collectJobsWithProfile(linkedInProfile, {
    linkedInEasyApplyOnly: true,
  });

  const easyApplyInDb = await JobModel.countDocuments({
    source: "linkedin",
    linkedInApplyType: "easy_apply",
    status: { $nin: ["dismissed"] },
  });
  return {
    found: result.found,
    eligible: result.eligible,
    easyApplyInDb,
    bySource: result.bySource,
  };
}

export async function analyzeJobById(
  jobId: string,
  ctx?: { profile?: UserProfile; resumeText?: string }
): Promise<void> {
  assertAiConfigured();

  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error(`Job ${jobId} not found`);

  const profile = ctx?.profile ?? (await getProfile());
  const resumeText = ctx?.resumeText ?? (await loadResumeText(profile));

  const analysis = await analyzeJobAgainstCv({
    title: doc.title,
    company: doc.company,
    location: doc.location ?? "",
    description: doc.description ?? "",
    tags: doc.tags ?? [],
    salary: doc.salary ?? "",
    profile,
    resumeText,
  });

  doc.aiMatchScore = analysis.aiMatchScore;
  doc.aiAnalyzedModel = getAiModelLabel();
  doc.matchSummary = analysis.matchSummary;
  doc.matchStrengths = analysis.matchStrengths;
  doc.matchGaps = analysis.matchGaps;
  doc.matchRecommendation = analysis.matchRecommendation;
  doc.analyzedAt = new Date();
  doc.status = "analyzed";
  doc.errorMessage = undefined;
  await doc.save();
}
