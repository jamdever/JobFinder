import { AutoApplyLogModel } from "../../models/AutoApplyLog.js";
import { JobModel } from "../../models/Job.js";
import { countLiveApplicationsToday } from "../apply/applyLimits.js";
import { delayBetweenAutoApplyJobs } from "../apply/applyTiming.js";
import { getProfile } from "../profile.js";
import { getCompletedJobIds } from "./jobCompletion.js";
import { runLinkedInEasyApplyPipeline } from "./pipeline.js";

/** Max jobs per manual queue run (Auto Apply watch has no per-scan cap). */
const MANUAL_QUEUE_CAP = 50;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applicationsSubmittedToday(): Promise<number> {
  return countLiveApplicationsToday();
}

export type ApplyQueueProgress = {
  applying: boolean;
  current?: number;
  total?: number;
  jobTitle?: string;
  lastApplyMessage?: string;
  appliedThisRun: number;
};

const progress: ApplyQueueProgress = {
  applying: false,
  appliedThisRun: 0,
};

export function getApplyQueueProgress(): ApplyQueueProgress {
  return { ...progress };
}

export async function processEasyApplyQueue(options?: {
  /** Only jobs added during this scan (Auto Apply watch). */
  since?: Date;
}): Promise<{
  processed: number;
  skipped: number;
  message: string;
}> {
  const profile = await getProfile();
  if (!profile.application.autoApplyWatchEnabled) {
    return { processed: 0, skipped: 0, message: "Auto Apply is off" };
  }

  if (progress.applying) {
    return { processed: 0, skipped: 0, message: "Already applying to jobs" };
  }

  progress.applying = true;
  progress.appliedThisRun = 0;
  progress.current = undefined;
  progress.total = undefined;
  progress.jobTitle = undefined;

  const dryRun = profile.application.autoApplyWatchDryRun !== false;
  const watchMode = !!options?.since;
  const manualCap = profile.application.autoApplyWatchMaxPerScan ?? MANUAL_QUEUE_CAP;
  const minAi = Math.round((profile.preferences.minMatchScore ?? 0.55) * 100);
  const delaySec = delayBetweenAutoApplyJobs(profile, dryRun);
  const dailyCap = profile.preferences.maxApplicationsPerDay ?? 15;
  const completedIds = await getCompletedJobIds();

  let processed = 0;
  let skipped = 0;

  try {
    const jobQuery: Record<string, unknown> = {
      status: { $nin: ["applied", "dismissed"] },
      linkedInApplyType: "easy_apply",
      url: { $regex: /linkedin\.com\/jobs/i },
    };
    if (options?.since) {
      jobQuery.createdAt = { $gte: options.since };
    }

    const jobs = await JobModel.find(jobQuery)
      .sort({ aiMatchScore: -1, matchScore: -1 })
      .limit(watchMode ? 200 : MANUAL_QUEUE_CAP);

    const queue: { id: string; title: string }[] = [];

    for (const doc of jobs) {
      if (doc.aiMatchScore != null && doc.aiMatchScore < minAi) {
        skipped++;
        continue;
      }
      if (completedIds.has(String(doc._id))) {
        skipped++;
        continue;
      }
      queue.push({ id: String(doc._id), title: doc.title });
      if (!watchMode && queue.length >= manualCap) break;
    }

    progress.total = queue.length;
    if (queue.length === 0) {
      progress.lastApplyMessage = watchMode
        ? "No new jobs from this scan to apply to"
        : "No new Easy Apply jobs to process";
      return { processed: 0, skipped, message: progress.lastApplyMessage };
    }

    console.log(
      `[autoapply] queue: ${queue.length} job(s) to process (${dryRun ? "dry run" : "live submit"})${watchMode ? " [this scan]" : ""}`
    );

    for (let i = 0; i < queue.length; i++) {
      const profileNow = await getProfile();
      if (!profileNow.application.autoApplyWatchEnabled) break;

      const submittedToday = await applicationsSubmittedToday();
      if (!dryRun && submittedToday >= dailyCap) {
        progress.lastApplyMessage = `Daily limit reached (${dailyCap} applications)`;
        console.log(`[autoapply] ${progress.lastApplyMessage}`);
        break;
      }

      const job = queue[i];
      progress.current = i + 1;
      progress.jobTitle = job.title;
      progress.lastApplyMessage = `Applying to ${job.title} (${i + 1}/${queue.length})…`;

      try {
        const result = await runLinkedInEasyApplyPipeline({
          jobId: job.id,
          dryRun,
          headless: false,
        });
        processed++;
        progress.appliedThisRun = processed;
        progress.lastApplyMessage = result.submitted
          ? `Submitted: ${job.title}`
          : dryRun
            ? `Dry run done: ${job.title}`
            : `Finished: ${job.title} — ${result.message}`;
        console.log(`[autoapply] queue ${i + 1}/${queue.length}: ${progress.lastApplyMessage}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress.lastApplyMessage = `Failed on ${job.title}: ${message}`;
        console.warn(`[autoapply] queue failed for ${job.id}:`, message);
      }

      if (i < queue.length - 1) {
        await sleep(delaySec * 1000);
      }
    }

    const summary = `Processed ${processed} application(s)${dryRun ? " (dry run)" : ""}`;
    progress.lastApplyMessage = summary;
    return { processed, skipped, message: summary };
  } finally {
    progress.applying = false;
    progress.current = undefined;
    progress.jobTitle = undefined;
  }
}
