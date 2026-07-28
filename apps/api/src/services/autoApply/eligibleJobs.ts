import { isLinkedInJob } from "@jobfinder/shared";
import type { AutoApplyCandidateDto } from "@jobfinder/shared";
import { JobModel } from "../../models/Job.js";
import { getProfile } from "../profile.js";
import {
  getJobApplyCompletionState,
  reconcileStaleAutoApplyCompletions,
} from "./jobCompletion.js";

export async function listEasyApplyCandidates(options?: {
  limit?: number;
  minAiScore?: number;
  includeApplied?: boolean;
}): Promise<AutoApplyCandidateDto[]> {
  await reconcileStaleAutoApplyCompletions();

  const profile = await getProfile();
  const limit = Math.min(options?.limit ?? 30, 50);
  const minAi =
    options?.minAiScore ??
    Math.round((profile.preferences.minMatchScore ?? 0.55) * 100);
  const includeApplied = options?.includeApplied !== false;

  const jobs = await JobModel.find({
    status: { $nin: includeApplied ? ["dismissed"] : ["applied", "dismissed"] },
    linkedInApplyType: "easy_apply",
    url: { $regex: /linkedin\.com\/jobs/i },
  })
    .sort({ aiMatchScore: -1, matchScore: -1 })
    .limit(limit * 3);

  const candidates: AutoApplyCandidateDto[] = [];

  for (const doc of jobs) {
    if (!isLinkedInJob({ source: doc.source, url: doc.url })) continue;
    if (doc.aiMatchScore != null && doc.aiMatchScore < minAi) continue;

    const id = String(doc._id);
    const completion = await getJobApplyCompletionState(id);
    const isApplied = completion.complete;

    if (!includeApplied && isApplied) continue;

    candidates.push({
      id,
      title: doc.title,
      company: doc.company,
      location: doc.location ?? "",
      url: doc.url,
      aiMatchScore: doc.aiMatchScore ?? undefined,
      matchRecommendation: doc.matchRecommendation ?? undefined,
      hasTailoredCv: Boolean(doc.tailoredCvMarkdown?.trim()),
      hasCoverLetter: Boolean(doc.coverLetter?.trim()),
      analyzedAt: doc.analyzedAt?.toISOString(),
      linkedInApplyType: "easy_apply",
      applicationStatus: isApplied ? "applied" : "open",
      appliedAt: completion.completedAt,
      appliedMessage: isApplied ? completion.message : undefined,
    });
  }

  candidates.sort((a, b) => {
    if (a.applicationStatus !== b.applicationStatus) {
      return a.applicationStatus === "applied" ? 1 : -1;
    }
    return (b.aiMatchScore ?? 0) - (a.aiMatchScore ?? 0);
  });

  return candidates.slice(0, limit);
}
