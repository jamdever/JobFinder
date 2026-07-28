import type { LinkedInApplyType } from "./jobMetadata.js";

/** Same values as LinkedInApplyType (filters + automation). */
export type LinkedInApplyMode = LinkedInApplyType;

export interface ApplyAutomationStep {
  step: number;
  action: string;
  detail?: string;
}

export interface ApplyAutomationResult {
  jobId: string;
  dryRun: boolean;
  submitted: boolean;
  needsManualReview: boolean;
  filledFields: string[];
  questionsAnswered: string[];
  resumeUploaded: boolean;
  cvPdfPath?: string;
  extraFields: number;
  steps: ApplyAutomationStep[];
  warnings: string[];
  screenshotDir: string;
  /** LinkedIn-only: how this job accepts applications */
  linkedInApplyMode?: LinkedInApplyMode;
  applicationUrlUsed?: string;
}
