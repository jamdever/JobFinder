import { enrichJob, type JobDto } from "@jobfinder/shared";
import { JOB_LIST_SELECT, JobModel, toJobListDto, type JobDocument } from "../models/Job.js";
import { dedupeJobDocs } from "./jobDedup.js";
import { matchesAnyTargetTitle } from "./matching.js";
import { getProfile } from "./profile.js";
import { jobMatchesSearchArea } from "./search/utils.js";

export async function listDashboardJobs(options?: {
  ids?: string[];
  limit?: number;
}): Promise<JobDto[]> {
  const profile = await getProfile();
  const limit = Math.min(options?.limit ?? 100, 100);
  const minMatch = profile.preferences.minMatchScore ?? 0.55;

  const filter: Record<string, unknown> = {
    matchScore: { $gte: minMatch },
    status: { $nin: ["dismissed"] },
  };
  if (options?.ids?.length) {
    filter._id = { $in: options.ids };
  }

  const hasTargets = profile.preferences.titles.some((t) => t.trim().length > 0);

  const docs = await JobModel.find(filter)
    .select(JOB_LIST_SELECT)
    .sort({ aiMatchScore: -1, matchScore: -1, discoveredAt: -1 })
    .limit(limit * 3)
    .lean();

  const relevant = hasTargets
    ? docs.filter(
        (doc) =>
          matchesAnyTargetTitle(profile, doc.title) &&
          jobMatchesSearchArea(profile, doc.location ?? "", "board")
      )
    : docs.filter((doc) => jobMatchesSearchArea(profile, doc.location ?? "", "board"));

  const deduped = dedupeJobDocs(relevant);
  return deduped
    .map((doc) => enrichJob(toJobListDto(doc as JobDocument) as JobDto))
    .slice(0, limit);
}
