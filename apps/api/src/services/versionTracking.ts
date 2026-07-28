import { randomUUID } from "node:crypto";
import type { AppliedJobDto, ApplicationVersionsDto } from "@jobfinder/shared";
import {
  ApplicationVersionModel,
  toApplicationVersionsDto,
  type ApplicationVersionDocument,
} from "../models/ApplicationVersion.js";
import { AutoApplyLogModel } from "../models/AutoApplyLog.js";
import { JobModel } from "../models/Job.js";
import { getProfile, loadResumeText } from "./profile.js";
import { getResumeMeta } from "./resume.js";

const APPLIED_CV_PLACEHOLDER =
  "Application recorded by JobFinder. Open the job match for your tailored CV and cover letter.";

function resolveOriginalCvText(
  doc: ApplicationVersionDocument | null,
  job: { tailoredCvMarkdown?: string | null },
  resumeText: string
): string {
  return (
    doc?.originalCv?.text?.trim() ||
    job.tailoredCvMarkdown?.trim() ||
    resumeText.trim() ||
    APPLIED_CV_PLACEHOLDER
  );
}

async function getOrCreateDoc(
  jobId: string,
  originalCvText: string,
  resumeFileName?: string
): Promise<ApplicationVersionDocument> {
  let doc = await ApplicationVersionModel.findOne({ jobId });
  if (!doc) {
    doc = await ApplicationVersionModel.create({
      jobId,
      originalCv: {
        text: originalCvText,
        capturedAt: new Date(),
        resumeFileName,
      },
      cvVersions: [],
      coverLetterVersions: [],
      appliedRecords: [],
    });
    return doc;
  }

  if (!doc.originalCv?.text?.trim()) {
    doc.originalCv = {
      text: originalCvText,
      capturedAt: new Date(),
      resumeFileName,
    };
    await doc.save();
  }

  return doc;
}

export async function captureOriginalCvIfNeeded(jobId: string): Promise<void> {
  const existing = await ApplicationVersionModel.findOne({ jobId }).select("originalCv");
  if (existing?.originalCv?.text?.trim()) return;

  const profile = await getProfile();
  const resumeText = await loadResumeText(profile);
  const { resumeFileName } = await getResumeMeta(profile);
  await getOrCreateDoc(jobId, resumeText, resumeFileName);
}

export async function appendTailoredCvVersion(params: {
  jobId: string;
  text: string;
  keyChanges: string[];
  model: string;
}): Promise<string> {
  const profile = await getProfile();
  const resumeText = await loadResumeText(profile);
  const { resumeFileName } = await getResumeMeta(profile);
  const doc = await getOrCreateDoc(params.jobId, resumeText, resumeFileName);

  const id = randomUUID();
  doc.cvVersions.push({
    id,
    text: params.text,
    keyChanges: params.keyChanges,
    model: params.model,
    createdAt: new Date(),
  });
  await doc.save();
  return id;
}

export async function appendCoverLetterVersion(params: {
  jobId: string;
  text: string;
  keyPoints: string[];
  model: string;
}): Promise<string> {
  const profile = await getProfile();
  const resumeText = await loadResumeText(profile);
  const { resumeFileName } = await getResumeMeta(profile);
  const doc = await getOrCreateDoc(params.jobId, resumeText, resumeFileName);

  const id = randomUUID();
  doc.coverLetterVersions.push({
    id,
    text: params.text,
    keyPoints: params.keyPoints,
    model: params.model,
    createdAt: new Date(),
  });
  await doc.save();
  return id;
}

export async function getVersionsForJob(jobId: string): Promise<ApplicationVersionsDto> {
  try {
    await captureOriginalCvIfNeeded(jobId);
  } catch {
    /* no CV uploaded yet */
  }

  const doc = await ApplicationVersionModel.findOne({ jobId });
  if (!doc) {
    return {
      jobId,
      cvVersions: [],
      coverLetterVersions: [],
      appliedRecords: [],
    };
  }
  return toApplicationVersionsDto(doc, jobId);
}

async function loadResumeTextSafe(): Promise<{ text: string; resumeFileName?: string }> {
  try {
    const profile = await getProfile();
    const text = await loadResumeText(profile);
    const { resumeFileName } = await getResumeMeta(profile);
    return { text: text.trim() || " ", resumeFileName };
  } catch {
    return { text: " " };
  }
}

async function ensureAppliedRecord(jobId: string, note: string): Promise<boolean> {
  const ver = await ApplicationVersionModel.findOne({ jobId }).select("appliedRecords");
  if (ver?.appliedRecords?.length) {
    const job = await JobModel.findById(jobId).select("status");
    if (job && job.status !== "applied") {
      job.status = "applied";
      job.appliedAt = job.appliedAt ?? new Date();
      await job.save();
    }
    return false;
  }

  try {
    await finalizeLiveApplication(jobId, note);
    return true;
  } catch (err) {
    console.warn(`[applications] record failed for ${jobId}:`, err);
    return false;
  }
}

/** Backfill Applied tab from jobs marked applied and successful live Auto Apply runs. */
export async function backfillMissingAppliedRecords(): Promise<number> {
  let added = 0;
  const seen = new Set<string>();

  const successLogs = await AutoApplyLogModel.find({
    status: "success",
    $or: [
      { submitted: true },
      { message: /submitted/i },
      { message: /dry run completed.*marked as applied/i },
      { dryRun: true, message: /dry run completed/i },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(100);

  for (const log of successLogs) {
    const jobId = String(log.jobId);
    if (seen.has(jobId)) continue;
    seen.add(jobId);
    if (await ensureAppliedRecord(jobId, "Submitted via LinkedIn Easy Apply (synced)")) {
      added++;
    }
  }

  const appliedJobs = await JobModel.find({ status: "applied" })
    .sort({ appliedAt: -1 })
    .limit(200);

  for (const job of appliedJobs) {
    const jobId = String(job._id);
    if (seen.has(jobId)) continue;
    seen.add(jobId);
    if (await ensureAppliedRecord(jobId, "Recorded from application history")) {
      added++;
    }
  }

  return added;
}

/** Record application + set job status (for Auto Apply and manual flows). Idempotent per job. */
export async function finalizeLiveApplication(
  jobId: string,
  note?: string
): Promise<void> {
  const job = await JobModel.findById(jobId);
  if (!job) return;

  job.status = "applied";
  job.appliedAt = job.appliedAt ?? new Date();
  await job.save();

  const existing = await ApplicationVersionModel.findOne({ jobId: job._id }).select(
    "appliedRecords"
  );
  if (existing?.appliedRecords?.length) return;

  try {
    await recordJobApplication({ jobId, note });
    return;
  } catch (err) {
    console.warn(`[applications] recordJobApplication failed for ${jobId}:`, err);
  }

  const { text: resumeText, resumeFileName } = await loadResumeTextSafe();
  let doc = await ApplicationVersionModel.findOne({ jobId: job._id });
  if (!doc) {
    const cvText = resolveOriginalCvText(null, job, resumeText);
    doc = await ApplicationVersionModel.create({
      jobId: job._id,
      originalCv: {
        text: cvText,
        capturedAt: new Date(),
        resumeFileName,
      },
      cvVersions: [],
      coverLetterVersions: [],
      appliedRecords: [],
    });
  }

  const appliedId = randomUUID();
  doc.appliedRecords.push({
    id: appliedId,
    appliedAt: new Date(),
    jobTitle: job.title,
    company: job.company,
    location: job.location ?? "",
    jobUrl: job.url,
    originalCvText: resolveOriginalCvText(doc, job, resumeText),
    tailoredCvText: job.tailoredCvMarkdown?.trim() || undefined,
    coverLetterText: job.coverLetter?.trim() || undefined,
    note: note?.trim() || undefined,
  });
  doc.lastAppliedAt = new Date();
  await doc.save();
}

export async function recordJobApplication(params: {
  jobId: string;
  note?: string;
}): Promise<{ versions: ApplicationVersionsDto; appliedRecordId: string }> {
  const job = await JobModel.findById(params.jobId);
  if (!job) throw new Error(`Job ${params.jobId} not found`);

  const { text: resumeText, resumeFileName } = await loadResumeTextSafe();
  const doc = await getOrCreateDoc(params.jobId, resumeText, resumeFileName);

  const latestCv = doc.cvVersions[doc.cvVersions.length - 1];
  const latestLetter = doc.coverLetterVersions[doc.coverLetterVersions.length - 1];

  const tailoredFromJob = job.tailoredCvMarkdown?.trim();
  const letterFromJob = job.coverLetter?.trim();

  const tailoredCvText = latestCv?.text ?? tailoredFromJob;
  const coverLetterText = latestLetter?.text ?? letterFromJob;

  job.status = "applied";
  job.appliedAt = job.appliedAt ?? new Date();
  await job.save();

  const appliedId = randomUUID();
  doc.appliedRecords.push({
    id: appliedId,
    appliedAt: new Date(),
    jobTitle: job.title,
    company: job.company,
    location: job.location ?? "",
    jobUrl: job.url,
    originalCvText: resolveOriginalCvText(doc, job, resumeText),
    tailoredCvText: tailoredCvText || undefined,
    coverLetterText: coverLetterText || undefined,
    tailoredCvVersionId: latestCv?.id,
    coverLetterVersionId: latestLetter?.id,
    note: params.note?.trim() || undefined,
  });
  doc.lastAppliedAt = new Date();
  await doc.save();

  return {
    versions: toApplicationVersionsDto(doc, params.jobId),
    appliedRecordId: appliedId,
  };
}

export async function listAppliedJobs(limit = 50): Promise<AppliedJobDto[]> {
  await backfillMissingAppliedRecords();

  const docs = await ApplicationVersionModel.find({
    "appliedRecords.0": { $exists: true },
  })
    .sort({ lastAppliedAt: -1 })
    .limit(limit);

  const rows: AppliedJobDto[] = [];
  for (const doc of docs) {
    const jobId = doc.jobId.toString();
    for (const record of [...(doc.appliedRecords ?? [])].reverse()) {
      rows.push({
        id: record.id,
        jobId,
        appliedAt: record.appliedAt?.toISOString() ?? new Date().toISOString(),
        jobTitle: record.jobTitle,
        company: record.company,
        location: record.location ?? "",
        jobUrl: record.jobUrl,
        hasTailoredCv: !!record.tailoredCvText?.trim(),
        hasCoverLetter: !!record.coverLetterText?.trim(),
        note: record.note ?? undefined,
      });
    }
  }

  return rows
    .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
    .slice(0, limit);
}
