import {
  assertAiConfigured,
  assertOllamaReachable,
  getAiModelLabel,
  getAiProvider,
} from "./ai/llm.js";
import { generateCoverLetterAgainstJob } from "./ai/coverLetter.js";
import { JobModel, toJobDto } from "../models/Job.js";
import { getProfile, loadResumeText } from "./profile.js";
import { appendCoverLetterVersion, captureOriginalCvIfNeeded } from "./versionTracking.js";

const GENERIC_APPLY_COVER_LETTER_RE =
  /^please see my attached cv/i;

/** True when the job has no tailored letter (missing or Indeed/LinkedIn placeholder). */
export function needsTailoredCoverLetterForApply(coverLetter: string | undefined): boolean {
  const text = coverLetter?.trim() ?? "";
  if (!text) return true;
  return GENERIC_APPLY_COVER_LETTER_RE.test(text);
}

/**
 * Ensure a job-specific cover letter exists before Auto Apply fills forms.
 * Reuses an existing tailored letter on the job; generates with AI when missing or generic.
 */
export async function ensureJobCoverLetterForApply(jobId: string): Promise<string> {
  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error(`Job ${jobId} not found`);

  if (!needsTailoredCoverLetterForApply(doc.coverLetter)) {
    return doc.coverLetter!.trim();
  }

  const result = await generateCoverLetterForJob(jobId);
  return result.coverLetter;
}

export async function generateCoverLetterForJob(jobId: string) {
  assertAiConfigured();
  if (getAiProvider() === "ollama") await assertOllamaReachable();

  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error(`Job ${jobId} not found`);

  const profile = await getProfile();
  const resumeText = await loadResumeText(profile);
  await captureOriginalCvIfNeeded(jobId);

  const result = await generateCoverLetterAgainstJob({
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

  doc.coverLetter = result.coverLetter;
  doc.coverLetterKeyPoints = result.keyPoints;
  doc.coverLetterAt = new Date();
  doc.coverLetterModel = getAiModelLabel();
  doc.coverLetterErrorMessage = undefined;
  await doc.save();

  const model = getAiModelLabel();
  await appendCoverLetterVersion({
    jobId,
    text: result.coverLetter,
    keyPoints: result.keyPoints,
    model,
  });

  return { job: toJobDto(doc), ...result, model };
}
