import { AutoApplyLogModel } from "../../models/AutoApplyLog.js";
import { ApplicationVersionModel } from "../../models/ApplicationVersion.js";
import { JobModel } from "../../models/Job.js";
import { finalizeLiveApplication } from "../versionTracking.js";

export type JobApplyCompletionReason =
  | "job_status"
  | "applied_record"
  | "live_submit_log"
  | "dry_run_log"
  | "success_log";

export interface JobApplyCompletionState {
  complete: boolean;
  reason?: JobApplyCompletionReason;
  message: string;
  completedAt?: string;
  dryRun?: boolean;
  liveSubmit?: boolean;
}

function logIndicatesComplete(message: string | undefined, submitted: boolean): boolean {
  if (submitted) return true;
  const m = (message ?? "").toLowerCase();
  return (
    /marked as applied/.test(m) ||
    /application submitted/.test(m) ||
    /dry run completed/.test(m) ||
    /already applied/.test(m) ||
    /already complete/.test(m)
  );
}

/** Whether this job is already done (applied tab, dry run, or live submit). */
export async function getJobApplyCompletionState(
  jobId: string
): Promise<JobApplyCompletionState> {
  const job = await JobModel.findById(jobId).select("status appliedAt title company");
  if (!job) {
    return { complete: false, message: "Job not found" };
  }

  if (job.status === "applied") {
    return {
      complete: true,
      reason: "job_status",
      message: `Already marked applied${job.appliedAt ? ` on ${job.appliedAt.toISOString().slice(0, 10)}` : ""}`,
      completedAt: job.appliedAt?.toISOString(),
    };
  }

  const version = await ApplicationVersionModel.findOne({ jobId: job._id }).select(
    "appliedRecords lastAppliedAt"
  );
  if (version?.appliedRecords?.length) {
    const last = version.appliedRecords[version.appliedRecords.length - 1];
    return {
      complete: true,
      reason: "applied_record",
      message: `Already recorded on Applied jobs (${last?.note ?? "application on file"})`,
      completedAt: last?.appliedAt?.toISOString() ?? version.lastAppliedAt?.toISOString(),
    };
  }

  const successLog = await AutoApplyLogModel.findOne({
    jobId: job._id,
    status: "success",
  })
    .sort({ createdAt: -1 })
    .select("message submitted dryRun createdAt");

  if (successLog && logIndicatesComplete(successLog.message, successLog.submitted ?? false)) {
    const dryRun = successLog.dryRun ?? false;
    return {
      complete: true,
      reason: dryRun ? "dry_run_log" : successLog.submitted ? "live_submit_log" : "success_log",
      message: successLog.message ?? (dryRun ? "Dry run completed" : "Application completed"),
      completedAt: successLog.createdAt?.toISOString(),
      dryRun,
      liveSubmit: !dryRun && (successLog.submitted ?? false),
    };
  }

  const submittedLog = await AutoApplyLogModel.findOne({
    jobId: job._id,
    submitted: true,
  }).sort({ createdAt: -1 });
  if (submittedLog) {
    return {
      complete: true,
      reason: "live_submit_log",
      message: submittedLog.message ?? "Previously submitted via Auto Apply",
      completedAt: submittedLog.createdAt?.toISOString(),
      liveSubmit: true,
    };
  }

  return { complete: false, message: "Not yet applied" };
}

export async function isJobApplyComplete(jobId: string): Promise<boolean> {
  return (await getJobApplyCompletionState(jobId)).complete;
}

/**
 * Skip starting Auto Apply when the job is already done.
 * Dry runs may be repeated unless a live submission already happened (or forceRetry).
 */
export async function shouldSkipAutoApplyRun(
  jobId: string,
  opts: { dryRun: boolean; forceRetry?: boolean }
): Promise<JobApplyCompletionState | null> {
  if (opts.forceRetry) return null;

  const state = await getJobApplyCompletionState(jobId);
  if (!state.complete) return null;

  if (opts.dryRun && !state.liveSubmit) {
    return null;
  }

  return reconcileJobCompletion(jobId);
}

/** If logs/records say done but job.status is not applied, sync Applied tab + status. */
export async function reconcileJobCompletion(jobId: string): Promise<JobApplyCompletionState> {
  const state = await getJobApplyCompletionState(jobId);
  if (!state.complete) return state;

  const job = await JobModel.findById(jobId).select("status");
  if (job?.status !== "applied") {
    const note =
      state.reason === "dry_run_log" || state.dryRun
        ? "Dry run completed — synced from Auto Apply history"
        : state.reason === "live_submit_log" || state.liveSubmit
          ? "Submitted via LinkedIn Easy Apply — synced from history"
          : "Application completed — synced from history";
    await finalizeLiveApplication(jobId, note);
  }

  return getJobApplyCompletionState(jobId);
}

export async function getCompletedJobIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  const appliedJobs = await JobModel.find({ status: "applied" }).select("_id");
  for (const j of appliedJobs) ids.add(String(j._id));

  const withRecords = await ApplicationVersionModel.find({
    "appliedRecords.0": { $exists: true },
  }).select("jobId");
  for (const v of withRecords) ids.add(String(v.jobId));

  const logs = await AutoApplyLogModel.find({
    status: "success",
    $or: [
      { submitted: true },
      { message: /marked as applied/i },
      { message: /application submitted/i },
      { message: /dry run completed/i },
    ],
  }).select("jobId");
  for (const l of logs) ids.add(String(l.jobId));

  const submittedLogs = await AutoApplyLogModel.find({ submitted: true }).select("jobId");
  for (const l of submittedLogs) ids.add(String(l.jobId));

  return ids;
}

/** Sync jobs that have success logs but were never marked applied in the DB. */
export async function reconcileStaleAutoApplyCompletions(): Promise<number> {
  const logs = await AutoApplyLogModel.find({
    status: "success",
    $or: [
      { submitted: true },
      { message: /marked as applied/i },
      { message: /application submitted/i },
      { message: /dry run completed/i },
    ],
  })
    .select("jobId")
    .limit(200);

  const seen = new Set<string>();
  let synced = 0;
  for (const log of logs) {
    const jobId = String(log.jobId);
    if (seen.has(jobId)) continue;
    seen.add(jobId);
    const job = await JobModel.findById(jobId).select("status");
    if (job?.status === "applied") continue;
    await reconcileJobCompletion(jobId);
    synced++;
  }
  return synced;
}
