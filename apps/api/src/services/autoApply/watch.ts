import type { AutoApplyWatchStatusDto } from "@jobfinder/shared";
import { collectLinkedInEasyApplyJobs } from "../matcher.js";
import { getProfile, updateProfile } from "../profile.js";
import { getApplyQueueProgress, processEasyApplyQueue } from "./applyQueue.js";

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

function buildWatchStatus(profile: Awaited<ReturnType<typeof getProfile>>): AutoApplyWatchStatusDto {
  const queue = getApplyQueueProgress();
  const enabled = profile.application.autoApplyWatchEnabled ?? false;
  return {
    enabled,
    applyEnabled: enabled,
    dryRun: profile.application.autoApplyWatchDryRun !== false,
    maxPerScan: profile.application.autoApplyWatchMaxPerScan ?? 2,
    intervalMinutes: clampIntervalMinutes(
      profile.application.autoApplyWatchIntervalMinutes ?? DEFAULT_INTERVAL_MIN
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
    if (!profile.application.autoApplyWatchEnabled) {
      stopAutoApplyWatch();
      return;
    }

    runtime.lastMessage = "Scanning LinkedIn for Easy Apply jobs…";
    console.log("[autoapply] watch scan started");

    const scanStartedAt = new Date();
    const result = await collectLinkedInEasyApplyJobs();

    runtime.lastScanAt = new Date();
    runtime.lastFound = result.found;
    runtime.lastEasyApplyTotal = result.easyApplyInDb;
    runtime.lastMessage = `Found ${result.found} new Easy Apply jobs · ${result.easyApplyInDb} Easy Apply in database`;

    console.log(`[autoapply] watch scan done: ${runtime.lastMessage}`);

    runtime.lastMessage = `${runtime.lastMessage} — applying to jobs found this scan…`;
    const queueResult = await processEasyApplyQueue({ since: scanStartedAt });
    runtime.lastMessage = `${runtime.lastMessage} · ${queueResult.message}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runtime.lastError = message;
    runtime.lastMessage = `Scan failed: ${message}`;
    console.warn("[autoapply] watch scan failed:", message);
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

export function stopAutoApplyWatch(): void {
  stopTimer();
  console.log("[autoapply] watch stopped");
}

/** Reset in-memory scan stats after clearing the Auto Apply queue. */
export function resetAutoApplyWatchRuntime(): void {
  runtime.scanning = false;
  runtime.lastScanAt = undefined;
  runtime.lastFound = undefined;
  runtime.lastEasyApplyTotal = undefined;
  runtime.lastError = undefined;
  runtime.lastMessage = "Queue cleared — scan again to find Easy Apply jobs";
}

export async function startAutoApplyWatch(): Promise<void> {
  const profile = await getProfile();
  const minutes = clampIntervalMinutes(
    profile.application.autoApplyWatchIntervalMinutes ?? DEFAULT_INTERVAL_MIN
  );

  stopTimer();
  void runScan();

  timer = setInterval(() => {
    void runScan();
  }, intervalMs(minutes));

  console.log(`[autoapply] watch started (every ${minutes} min)`);
}

export async function getAutoApplyWatchStatus(): Promise<AutoApplyWatchStatusDto> {
  const profile = await getProfile();
  return buildWatchStatus(profile);
}

export async function setAutoApplyWatch(options: {
  enabled?: boolean;
  applyEnabled?: boolean;
  dryRun?: boolean;
  maxPerScan?: number;
  intervalMinutes?: number;
}): Promise<AutoApplyWatchStatusDto> {
  const profile = await getProfile();
  const intervalMinutes =
    options.intervalMinutes != null
      ? clampIntervalMinutes(options.intervalMinutes)
      : clampIntervalMinutes(profile.application.autoApplyWatchIntervalMinutes ?? DEFAULT_INTERVAL_MIN);

  const nextEnabled =
    options.enabled !== undefined
      ? options.enabled
      : (profile.application.autoApplyWatchEnabled ?? false);
  // One switch: scan + apply are always on or off together.
  const nextApply = nextEnabled;

  await updateProfile({
    application: {
      ...profile.application,
      autoApplyWatchEnabled: nextEnabled,
      autoApplyWatchApplyEnabled: nextApply,
      autoApplyWatchDryRun: nextEnabled
        ? false
        : options.dryRun !== undefined
          ? options.dryRun
          : profile.application.autoApplyWatchDryRun !== false,
      autoApplyWatchMaxPerScan:
        options.maxPerScan ?? profile.application.autoApplyWatchMaxPerScan ?? 2,
      autoApplyWatchIntervalMinutes: intervalMinutes,
    },
  });

  if (nextEnabled) {
    await startAutoApplyWatch();
  } else {
    stopAutoApplyWatch();
    runtime.lastMessage = "Auto Apply watch is off";
  }

  return getAutoApplyWatchStatus();
}

/** Resume watch after API restart if it was left enabled. */
export async function resumeAutoApplyWatchIfEnabled(): Promise<void> {
  const profile = await getProfile();
  if (profile.application.autoApplyWatchEnabled) {
    await startAutoApplyWatch();
  }
}
