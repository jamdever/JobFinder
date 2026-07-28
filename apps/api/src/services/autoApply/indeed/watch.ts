import type { IndeedAutoApplyWatchStatusDto } from "@jobfinder/shared";
import { collectIndeedEasyApplyJobs } from "../../matcher.js";
import { getProfile, updateProfile } from "../../profile.js";
import { getIndeedApplyQueueProgress, processIndeedEasyApplyQueue } from "./applyQueue.js";

const DEFAULT_INTERVAL_MIN = 15;
const MIN_INTERVAL_MIN = 5;
const MAX_INTERVAL_MIN = 120;

type WatchRuntime = {
  scanning: boolean;
  lastScanAt?: Date;
  lastMessage?: string;
  lastFound?: number;
  lastEasyApplyTotal?: number;
  lastError?: string;
};

const runtime: WatchRuntime = { scanning: false };
let timer: ReturnType<typeof setInterval> | null = null;

function clampIntervalMinutes(minutes: number): number {
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, minutes));
}

function intervalMs(minutes: number): number {
  return clampIntervalMinutes(minutes) * 60 * 1000;
}

function buildWatchStatus(
  profile: Awaited<ReturnType<typeof getProfile>>
): IndeedAutoApplyWatchStatusDto {
  const queue = getIndeedApplyQueueProgress();
  const enabled = profile.application.indeedAutoApplyWatchEnabled ?? false;
  return {
    enabled,
    applyEnabled: enabled,
    dryRun: profile.application.indeedAutoApplyWatchDryRun !== false,
    maxPerScan: profile.application.indeedAutoApplyWatchMaxPerScan ?? 2,
    intervalMinutes: clampIntervalMinutes(
      profile.application.indeedAutoApplyWatchIntervalMinutes ?? DEFAULT_INTERVAL_MIN
    ),
    scanning: runtime.scanning,
    applying: queue.applying,
    applyCurrent: queue.current,
    applyTotal: queue.total,
    applyJobTitle: queue.jobTitle,
    lastScanAt: runtime.lastScanAt?.toISOString(),
    lastMessage: queue.applying
      ? queue.lastApplyMessage ?? runtime.lastMessage
      : runtime.lastMessage,
    lastFound: runtime.lastFound,
    lastEasyApplyTotal: runtime.lastEasyApplyTotal,
    lastError: runtime.lastError,
    lastApplyMessage: queue.lastApplyMessage,
    appliedThisRun: queue.appliedThisRun,
  };
}

async function runScan(): Promise<void> {
  if (runtime.scanning) return;

  runtime.scanning = true;
  runtime.lastError = undefined;

  try {
    const profile = await getProfile();
    if (!profile.application.indeedAutoApplyWatchEnabled) {
      stopIndeedAutoApplyWatch();
      return;
    }

    runtime.lastMessage = "Scanning Indeed for Easy Apply jobs…";
    console.log("[autoapply-indeed] watch scan started");

    const scanStartedAt = new Date();
    const result = await collectIndeedEasyApplyJobs();

    runtime.lastScanAt = new Date();
    runtime.lastFound = result.found;
    runtime.lastEasyApplyTotal = result.easyApplyInDb;
    runtime.lastMessage = `Found ${result.found} new Indeed jobs · ${result.easyApplyInDb} Easy Apply in database`;

    console.log(`[autoapply-indeed] watch scan done: ${runtime.lastMessage}`);

    runtime.lastMessage = `${runtime.lastMessage} — applying to jobs found this scan…`;
    const queueResult = await processIndeedEasyApplyQueue({ since: scanStartedAt });
    runtime.lastMessage = `${runtime.lastMessage} · ${queueResult.message}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runtime.lastError = message;
    runtime.lastMessage = `Scan failed: ${message}`;
    console.warn("[autoapply-indeed] watch scan failed:", message);
  } finally {
    runtime.scanning = false;
  }
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function stopIndeedAutoApplyWatch(): void {
  stopTimer();
  console.log("[autoapply-indeed] watch stopped");
}

export function resetIndeedAutoApplyWatchRuntime(): void {
  runtime.scanning = false;
  runtime.lastScanAt = undefined;
  runtime.lastFound = undefined;
  runtime.lastEasyApplyTotal = undefined;
  runtime.lastError = undefined;
  runtime.lastMessage = "Queue cleared — scan again to find Indeed Easy Apply jobs";
}

export async function startIndeedAutoApplyWatch(): Promise<void> {
  const profile = await getProfile();
  const minutes = clampIntervalMinutes(
    profile.application.indeedAutoApplyWatchIntervalMinutes ?? DEFAULT_INTERVAL_MIN
  );

  stopTimer();
  void runScan();

  timer = setInterval(() => {
    void runScan();
  }, intervalMs(minutes));

  console.log(`[autoapply-indeed] watch started (every ${minutes} min)`);
}

export async function getIndeedAutoApplyWatchStatus(): Promise<IndeedAutoApplyWatchStatusDto> {
  const profile = await getProfile();
  return buildWatchStatus(profile);
}

export async function setIndeedAutoApplyWatch(options: {
  enabled?: boolean;
  applyEnabled?: boolean;
  dryRun?: boolean;
  maxPerScan?: number;
  intervalMinutes?: number;
}): Promise<IndeedAutoApplyWatchStatusDto> {
  const profile = await getProfile();
  const intervalMinutes =
    options.intervalMinutes != null
      ? clampIntervalMinutes(options.intervalMinutes)
      : clampIntervalMinutes(
          profile.application.indeedAutoApplyWatchIntervalMinutes ?? DEFAULT_INTERVAL_MIN
        );

  const nextEnabled =
    options.enabled !== undefined
      ? options.enabled
      : (profile.application.indeedAutoApplyWatchEnabled ?? false);
  const nextApply = nextEnabled;

  await updateProfile({
    application: {
      ...profile.application,
      indeedAutoApplyWatchEnabled: nextEnabled,
      indeedAutoApplyWatchApplyEnabled: nextApply,
      indeedAutoApplyWatchDryRun: nextEnabled
        ? false
        : options.dryRun !== undefined
          ? options.dryRun
          : profile.application.indeedAutoApplyWatchDryRun !== false,
      indeedAutoApplyWatchMaxPerScan:
        options.maxPerScan ?? profile.application.indeedAutoApplyWatchMaxPerScan ?? 2,
      indeedAutoApplyWatchIntervalMinutes: intervalMinutes,
    },
  });

  if (nextEnabled) {
    await startIndeedAutoApplyWatch();
  } else {
    stopIndeedAutoApplyWatch();
    runtime.lastMessage = "Auto Apply Indeed watch is off";
  }

  return getIndeedAutoApplyWatchStatus();
}

export async function resumeIndeedAutoApplyWatchIfEnabled(): Promise<void> {
  const profile = await getProfile();
  if (profile.application.indeedAutoApplyWatchEnabled) {
    await startIndeedAutoApplyWatch();
  }
}
