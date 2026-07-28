import type { ApplyAutomationResult } from "./applyAutomation.js";

export type AutoApplyStage =
  | "queued"
  | "find_match"
  | "ai_score"
  | "tailor_cv"
  | "open_job"
  | "fill_form"
  | "upload_cv"
  | "submit"
  | "log_result"
  | "done";

export type AutoApplyRunStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface AutoApplyLogDto {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  jobUrl: string;
  status: AutoApplyRunStatus;
  stage: AutoApplyStage;
  message: string;
  submitted: boolean;
  dryRun: boolean;
  aiMatchScore?: number;
  result?: ApplyAutomationResult;
  createdAt: string;
  updatedAt: string;
}

export type AutoApplyCandidateStatus = "open" | "applied";

export interface AutoApplyCandidateDto {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  aiMatchScore?: number;
  matchRecommendation?: string;
  hasTailoredCv: boolean;
  hasCoverLetter: boolean;
  analyzedAt?: string;
  linkedInApplyType: "easy_apply";
  /** open = still to apply; applied = done (dry run or live) */
  applicationStatus: AutoApplyCandidateStatus;
  appliedAt?: string;
  appliedMessage?: string;
}

/** Indeed Easy Apply queue (same shape as LinkedIn candidates). */
export interface IndeedAutoApplyCandidateDto {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  aiMatchScore?: number;
  matchRecommendation?: string;
  hasTailoredCv: boolean;
  hasCoverLetter: boolean;
  analyzedAt?: string;
  indeedApplyType: "easy_apply";
  applicationStatus: AutoApplyCandidateStatus;
  appliedAt?: string;
  appliedMessage?: string;
}

export type IndeedAutoApplyWatchStatusDto = AutoApplyWatchStatusDto;

/** Which site to open for manual apply-browser login setup. */
export type ApplyBrowserLoginPlatform = "linkedin" | "indeed" | "both";

export interface AutoApplyRunResult {
  logId: string;
  jobId: string;
  status: AutoApplyRunStatus;
  stage: AutoApplyStage;
  message: string;
  submitted: boolean;
  dryRun: boolean;
  automation?: ApplyAutomationResult;
}

export interface AutoApplyWatchStatusDto {
  enabled: boolean;
  applyEnabled: boolean;
  dryRun: boolean;
  maxPerScan: number;
  intervalMinutes: number;
  scanning: boolean;
  applying: boolean;
  applyCurrent?: number;
  applyTotal?: number;
  applyJobTitle?: string;
  lastScanAt?: string;
  lastMessage?: string;
  lastFound?: number;
  lastEasyApplyTotal?: number;
  lastError?: string;
  lastApplyMessage?: string;
  appliedThisRun?: number;
}
