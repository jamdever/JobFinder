import type { Page } from "playwright";
import type { ApplyAutomationResult, ApplyAutomationStep } from "@jobfinder/shared";
import type { UserProfile } from "@jobfinder/shared";

export type { ApplyAutomationResult, ApplyAutomationStep };

export interface ApplyContext {
  jobId: string;
  url: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  coverLetter: string;
  profile: UserProfile;
  screeningAnswers: Record<string, string>;
  /** Resume plain text for AI screening answers */
  resumeText: string;
  cvPdfPath: string;
  dryRun: boolean;
  headless: boolean;
  requireManualSubmit: boolean;
  screenshotDir: string;
  /** LinkedIn Easy Apply only — rejects external apply jobs */
  linkedInEasyApplyOnly?: boolean;
  /** Indeed Smart Apply only — rejects “Apply on company site” jobs */
  indeedEasyApplyOnly?: boolean;
  /** Browser already launched and on `url` (dry-run fast path). */
  preopenedBrowser?: {
    page: Page;
    close: () => Promise<void>;
  };
}

export interface StepFillResult {
  filledFields: string[];
  questionsAnswered: string[];
  extraFields: number;
}
