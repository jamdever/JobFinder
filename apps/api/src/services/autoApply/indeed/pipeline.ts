import type { AutoApplyRunResult, AutoApplyStage } from "@jobfinder/shared";
import { AutoApplyLogModel, toAutoApplyLogDto } from "../../../models/AutoApplyLog.js";
import { JobModel } from "../../../models/Job.js";
import { isIndeedJobUrl } from "../../apply/applyBrowserLogin.js";
import { runApplyAutomationForJob } from "../../applyAutomation.js";
import {
  applicationRecordNote,
  automationIndicatesSubmit,
  automationOutcomeMessage,
  shouldRecordApplication,
} from "../../apply/finalizeApplication.js";
import {
  forceReleaseAutomationBrowserLock,
  isAutomationBrowserBusy,
} from "../../apply/browserLock.js";
import { analyzeJobById } from "../../matcher.js";
import { tailorCvForJob } from "../../cvTailor.js";
import { ensureJobCoverLetterForApply } from "../../coverLetter.js";
import { finalizeLiveApplication } from "../../versionTracking.js";
import { getProfile, loadResumeText } from "../../profile.js";
import { shouldSkipAutoApplyRun } from "../jobCompletion.js";

async function updateLog(
  logId: string,
  patch: {
    status?: "pending" | "running" | "success" | "failed" | "skipped";
    stage?: AutoApplyStage;
    message?: string;
    submitted?: boolean;
    aiMatchScore?: number;
    result?: unknown;
  }
) {
  await AutoApplyLogModel.findByIdAndUpdate(logId, { $set: patch });
}

export async function runIndeedEasyApplyPipeline(params: {
  jobId: string;
  dryRun?: boolean;
  headless?: boolean;
  skipAnalyze?: boolean;
  skipTailor?: boolean;
  /** Re-run even if a previous live apply completed (dry runs always allowed unless live submit). */
  forceRetry?: boolean;
}): Promise<AutoApplyRunResult> {
  const { jobId, dryRun = true, headless = false, forceRetry = false } = params;

  const staleRunning = await AutoApplyLogModel.findOne({
    jobId,
    status: "running",
    jobUrl: { $regex: /indeed\.com/i },
    createdAt: { $lt: new Date(Date.now() - 8 * 60 * 1000) },
  });
  if (staleRunning) {
    await AutoApplyLogModel.findByIdAndUpdate(staleRunning._id, {
      $set: {
        status: "skipped",
        message: "Previous run timed out — started a new attempt",
      },
    });
    forceReleaseAutomationBrowserLock();
  }

  if (isAutomationBrowserBusy()) {
    throw new Error("Another Auto Apply run is already using the browser. Wait for it to finish.");
  }

  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error(`Job ${jobId} not found`);
  if (doc.source !== "indeed" && !isIndeedJobUrl(doc.url)) {
    throw new Error("Auto Apply Indeed only supports Indeed job postings.");
  }

  const profile = await getProfile();
  const fast = profile.application.autoApplyFastMode !== false;
  const skipAnalyze =
    params.skipAnalyze === true || dryRun || (fast && !!doc.analyzedAt);
  const skipTailor =
    params.skipTailor === true || dryRun || (fast && !!doc.tailoredCvMarkdown?.trim());

  if (doc.indeedApplyType !== "easy_apply") {
    throw new Error(
      "This job is not tagged as Indeed Easy Apply. Scan Indeed Easy Apply jobs again."
    );
  }

  const skip = await shouldSkipAutoApplyRun(jobId, { dryRun, forceRetry });
  if (skip) {
    const log = await AutoApplyLogModel.create({
      jobId: doc._id,
      jobTitle: doc.title,
      company: doc.company,
      jobUrl: doc.url,
      status: "skipped",
      stage: "log_result",
      message: `Already complete — ${skip.message}`,
      dryRun,
      submitted: skip.liveSubmit ?? false,
    });
    return {
      logId: String(log._id),
      jobId,
      status: "skipped",
      stage: "log_result",
      message: `Already complete — ${skip.message}`,
      submitted: skip.liveSubmit ?? false,
      dryRun,
    };
  }

  const log = await AutoApplyLogModel.create({
    jobId: doc._id,
    jobTitle: doc.title,
    company: doc.company,
    jobUrl: doc.url,
    status: "running",
    stage: "find_match",
    message: "Starting Indeed Easy Apply pipeline",
    dryRun,
    submitted: false,
  });
  const logId = String(log._id);

  try {
    await updateLog(logId, { stage: "find_match", message: "Job matched for Indeed Easy Apply" });

    if (dryRun) {
      await updateLog(logId, {
        stage: "open_job",
        message: "Opening Indeed in browser…",
      });
    }

    if (!skipAnalyze) {
      await updateLog(logId, { stage: "ai_score", message: "Scoring job against CV…" });
      const resumeText = await loadResumeText(profile);
      if (resumeText.trim().length < 40) {
        throw new Error("Upload your CV in Settings before running Auto Apply.");
      }
      if (!doc.analyzedAt) {
        await analyzeJobById(jobId, { profile, resumeText });
      }
    }

    let refreshed = await JobModel.findById(jobId);
    if (!refreshed) throw new Error("Job not found after analysis");

    await updateLog(logId, {
      aiMatchScore: refreshed.aiMatchScore ?? undefined,
      message: refreshed.aiMatchScore
        ? `AI match score: ${refreshed.aiMatchScore}`
        : "Analysis complete",
    });

    if (!skipTailor && !refreshed.tailoredCvMarkdown?.trim()) {
      await updateLog(logId, { stage: "tailor_cv", message: "Generating tailored CV…" });
      await tailorCvForJob(jobId);
      refreshed = await JobModel.findById(jobId);
      if (!refreshed) throw new Error("Job not found after tailoring");
    }

    await updateLog(logId, {
      stage: "tailor_cv",
      message: "Writing tailored cover letter for this role…",
    });
    await ensureJobCoverLetterForApply(jobId);
    refreshed = await JobModel.findById(jobId);
    if (!refreshed) throw new Error("Job not found after cover letter");

    if (!dryRun) {
      await updateLog(logId, {
        stage: "open_job",
        message: "Opening Indeed apply flow in Playwright…",
      });
    }

    const automation = await runApplyAutomationForJob({
      jobId,
      dryRun,
      headless,
      useTailoredCv: !dryRun,
      linkedInEasyApplyOnly: false,
      indeedEasyApplyOnly: true,
    });

    const shouldMark = shouldRecordApplication(automation, dryRun, {
      linkedInEasyApplyOnly: false,
      indeedEasyApplyOnly: true,
    });
    if (shouldMark) {
      await finalizeLiveApplication(
        jobId,
        applicationRecordNote(automation, dryRun, false, true)
      );
    }

    const outcome = automationOutcomeMessage(automation, dryRun);
    const submitted = !dryRun && (automation.submitted || automationIndicatesSubmit(automation));

    await updateLog(logId, {
      status: outcome.status,
      stage: "log_result",
      message: outcome.message,
      submitted,
      result: automation,
    });

    const final = await AutoApplyLogModel.findById(logId);
    if (!final) throw new Error("Log missing after run");

    return {
      logId,
      jobId,
      status: final.status as AutoApplyRunResult["status"],
      stage: final.stage as AutoApplyStage,
      message: final.message ?? "",
      submitted: final.submitted ?? false,
      dryRun: final.dryRun ?? true,
      automation,
    };
  } catch (err) {
    forceReleaseAutomationBrowserLock();
    const message = err instanceof Error ? err.message : String(err);
    await updateLog(logId, {
      status: dryRun ? "skipped" : "failed",
      stage: "log_result",
      message: dryRun
        ? `${message} — try again after fixing the issue`
        : message,
    });
    throw err;
  }
}

export async function listIndeedAutoApplyLogs(limit = 30) {
  const logs = await AutoApplyLogModel.find({ jobUrl: { $regex: /indeed\.com/i } })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100));
  return logs.map(toAutoApplyLogDto);
}
