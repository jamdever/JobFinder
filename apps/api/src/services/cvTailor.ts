import {
  assertAiConfigured,
  assertOllamaReachable,
  getAiModelLabel,
  getAiProvider,
} from "./ai/llm.js";
import { JobModel, toJobDto } from "../models/Job.js";
import { tailorCvAgainstJob } from "./ai/cvTailor.js";
import { getProfile, loadResumeText } from "./profile.js";
import { appendTailoredCvVersion, captureOriginalCvIfNeeded } from "./versionTracking.js";

export async function tailorCvForJob(jobId: string) {
  assertAiConfigured();
  if (getAiProvider() === "ollama") await assertOllamaReachable();

  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error(`Job ${jobId} not found`);

  const profile = await getProfile();
  const resumeText = await loadResumeText(profile);
  await captureOriginalCvIfNeeded(jobId);

  const result = await tailorCvAgainstJob({
    title: doc.title,
    company: doc.company,
    location: doc.location ?? "",
    description: doc.description ?? "",
    tags: doc.tags ?? [],
    salary: doc.salary ?? "",
    profile,
    resumeText,
    matchStrengths: doc.matchStrengths ?? [],
    matchGaps: doc.matchGaps ?? [],
  });

  doc.tailoredCvMarkdown = result.tailoredCvMarkdown;
  doc.tailoredCvChanges = result.keyChanges;
  doc.tailoredCvAt = new Date();
  doc.tailoredCvModel = getAiModelLabel();
  doc.tailorErrorMessage = undefined;
  await doc.save();

  const model = getAiModelLabel();
  await appendTailoredCvVersion({
    jobId,
    text: result.tailoredCvMarkdown,
    keyChanges: result.keyChanges,
    model,
  });

  return { job: toJobDto(doc), ...result, model };
}
