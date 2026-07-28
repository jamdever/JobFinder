import fs from "node:fs/promises";
import path from "node:path";
import type { ApplyAutomationResult } from "@jobfinder/shared";
import type { UserProfile } from "@jobfinder/shared";
import { env } from "../config.js";
import { JobModel } from "../models/Job.js";
import { launchAutomationContext } from "./apply/browserSession.js";
import { normalizeIndeedJobUrl } from "./apply/indeedApply.js";
import { navigateIndeedJobWithSession } from "./apply/indeedSession.js";
import { runApplicationAutomation } from "./apply/runner.js";
import { markdownCvToPdf, safePdfFilename } from "./cvPdf.js";
import { ensureJobCoverLetterForApply } from "./coverLetter.js";
import { getProfile, loadResumeText } from "./profile.js";
import { loadResumeBuffer } from "./resume.js";
import {
  applicationRecordNote,
  shouldRecordApplication,
} from "./apply/finalizeApplication.js";
import { countLiveApplicationsToday } from "./apply/applyLimits.js";
import { finalizeLiveApplication } from "./versionTracking.js";

type JobDoc = NonNullable<Awaited<ReturnType<typeof JobModel.findById>>>;

async function buildCvPdfPath(
  doc: JobDoc,
  profile: UserProfile,
  screenshotDir: string,
  useTailoredCv: boolean
): Promise<string> {
  if (useTailoredCv && doc.tailoredCvMarkdown?.trim()) {
    const pdf = await markdownCvToPdf(doc.tailoredCvMarkdown);
    const name = safePdfFilename(doc.title, doc.company);
    const cvPdfPath = path.join(screenshotDir, name);
    await fs.writeFile(cvPdfPath, pdf);
    return cvPdfPath;
  }
  const buffer = await loadResumeBuffer(profile);
  const cvPdfPath = path.join(screenshotDir, "resume-upload.pdf");
  await fs.writeFile(cvPdfPath, buffer);
  return cvPdfPath;
}

export async function runApplyAutomationForJob(params: {
  jobId: string;
  dryRun?: boolean;
  headless?: boolean;
  useTailoredCv?: boolean;
  linkedInEasyApplyOnly?: boolean;
  indeedEasyApplyOnly?: boolean;
}): Promise<ApplyAutomationResult> {
  const {
    jobId,
    dryRun = true,
    headless = false,
    useTailoredCv = true,
    linkedInEasyApplyOnly = false,
    indeedEasyApplyOnly = false,
  } = params;

  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error(`Job ${jobId} not found`);

  if (linkedInEasyApplyOnly) {
    if (!/linkedin\.com\/jobs/i.test(doc.url)) {
      throw new Error("Auto Apply only supports LinkedIn job URLs.");
    }
    if (doc.linkedInApplyType && doc.linkedInApplyType !== "easy_apply") {
      throw new Error("This job is not LinkedIn Easy Apply.");
    }
  }

  const isIndeedJob =
    indeedEasyApplyOnly || /indeed\.com/i.test(doc.url) || doc.source === "indeed";
  const jobUrl = isIndeedJob
    ? normalizeIndeedJobUrl(doc.url, doc.externalId ?? undefined)
    : doc.url;

  const profile = await getProfile();

  let coverLetter = doc.coverLetter?.trim() ?? "";
  if (linkedInEasyApplyOnly || isIndeedJob) {
    coverLetter = await ensureJobCoverLetterForApply(jobId);
    const refreshed = await JobModel.findById(jobId);
    if (refreshed?.coverLetter?.trim()) {
      coverLetter = refreshed.coverLetter.trim();
    }
  } else if (!coverLetter) {
    throw new Error(
      "Generate a cover letter first (job page → Generated documents → Generate cover letter)."
    );
  }
  if (!dryRun) {
    const appliedToday = await countLiveApplicationsToday();
    if (appliedToday >= profile.preferences.maxApplicationsPerDay) {
      throw new Error(
        "Daily application limit reached. Try again tomorrow or raise the limit in Profile."
      );
    }
  }

  const screenshotDir = path.join(env.uploadsDir, jobId, `run-${Date.now()}`);
  await fs.mkdir(screenshotDir, { recursive: true });

  const screeningAnswers = doc.screeningAnswers
    ? Object.fromEntries(doc.screeningAnswers as Map<string, string>)
    : {};

  const effectiveUseTailoredCv = useTailoredCv && !dryRun;
  const isLinkedInJob = /linkedin\.com\/jobs/i.test(doc.url);
  const isIndeedJobApply = isIndeedJob;
  const openBrowserFirst =
    dryRun && (linkedInEasyApplyOnly || indeedEasyApplyOnly || isLinkedInJob || isIndeedJobApply);

  let preopenedBrowser: { page: import("playwright").Page; close: () => Promise<void> } | undefined;
  let cvPdfPath: string;
  let resumeText: string;

  if (openBrowserFirst) {
    const { page, close } = await launchAutomationContext(headless);
    preopenedBrowser = { page, close };
    const navigation = isIndeedJobApply
      ? navigateIndeedJobWithSession(page, jobUrl)
      : page.goto(jobUrl, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
    const cvPrep = buildCvPdfPath(doc, profile, screenshotDir, effectiveUseTailoredCv);
    const resumeTextPromise = loadResumeText(profile).catch(() => "");
    const [, cvPath, loadedResume] = await Promise.all([
      navigation,
      cvPrep,
      resumeTextPromise,
    ]);
    cvPdfPath = cvPath;
    resumeText = loadedResume;
  } else {
    cvPdfPath = await buildCvPdfPath(doc, profile, screenshotDir, effectiveUseTailoredCv);
    try {
      resumeText = await loadResumeText(profile);
    } catch {
      resumeText = "";
    }
  }

  const result = await runApplicationAutomation({
    jobId,
    url: jobUrl,
    jobTitle: doc.title,
    company: doc.company,
    jobDescription: doc.description ?? "",
    coverLetter,
    profile,
    screeningAnswers,
    resumeText,
    cvPdfPath,
    dryRun,
    headless,
    requireManualSubmit:
      !linkedInEasyApplyOnly &&
      profile.application.requireSubmitConfirmation &&
      !dryRun,
    screenshotDir,
    linkedInEasyApplyOnly,
    indeedEasyApplyOnly,
    preopenedBrowser,
  });

  if (shouldRecordApplication(result, dryRun, { linkedInEasyApplyOnly, indeedEasyApplyOnly })) {
    await finalizeLiveApplication(
      jobId,
      applicationRecordNote(result, dryRun, linkedInEasyApplyOnly, indeedEasyApplyOnly)
    );
  }

  return result;
}
