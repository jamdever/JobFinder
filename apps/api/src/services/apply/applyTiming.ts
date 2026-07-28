import type { UserProfile } from "@jobfinder/shared";

export interface ApplyTiming {
  maxFormSteps: number;
  formStabilityMs: number;
  linkedInClickDelayMs: number;
  captureStepScreenshots: boolean;
  dryRunAdvancePasses: number;
  /** Retries to clear validation errors on one Easy Apply step before advancing. */
  dryRunFixPasses: number;
}

const STANDARD: ApplyTiming = {
  maxFormSteps: 12,
  formStabilityMs: 2000,
  linkedInClickDelayMs: 2000,
  captureStepScreenshots: true,
  dryRunAdvancePasses: 6,
  dryRunFixPasses: 8,
};

const FAST: ApplyTiming = {
  maxFormSteps: 12,
  formStabilityMs: 500,
  linkedInClickDelayMs: 600,
  captureStepScreenshots: false,
  dryRunAdvancePasses: 6,
  dryRunFixPasses: 3,
};

let activeTiming: ApplyTiming = FAST;

export function resolveApplyTiming(
  profile: UserProfile,
  linkedInEasyApplyOnly?: boolean,
  indeedEasyApplyOnly?: boolean
): ApplyTiming {
  const fast =
    (linkedInEasyApplyOnly || indeedEasyApplyOnly) &&
    profile.application.autoApplyFastMode !== false;
  const base = fast ? { ...FAST } : { ...STANDARD };
  if (indeedEasyApplyOnly) {
    return {
      ...base,
      maxFormSteps: 14,
      dryRunAdvancePasses: 18,
      formStabilityMs: Math.max(base.formStabilityMs, 1200),
    };
  }
  return base;
}

export function setActiveApplyTiming(timing: ApplyTiming): void {
  activeTiming = timing;
}

export function getActiveApplyTiming(): ApplyTiming {
  return activeTiming;
}

/** Delay between jobs in the auto-apply queue (seconds). */
export function delayBetweenAutoApplyJobs(
  profile: UserProfile,
  dryRun: boolean
): number {
  if (profile.application.autoApplyFastMode !== false) {
    return dryRun ? 2 : Math.min(profile.application.delayBetweenApplications ?? 5, 10);
  }
  return dryRun ? 5 : profile.application.delayBetweenApplications ?? 30;
}
