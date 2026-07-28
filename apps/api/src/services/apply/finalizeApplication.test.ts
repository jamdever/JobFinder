import assert from "node:assert/strict";
import type { ApplyAutomationResult } from "@jobfinder/shared";
import {
  automationOutcomeMessage,
  dryRunCompletedSuccessfully,
  shouldRecordApplication,
} from "./finalizeApplication.js";

function mockResult(partial: Partial<ApplyAutomationResult>): ApplyAutomationResult {
  return {
    jobId: "test",
    dryRun: true,
    submitted: false,
    needsManualReview: false,
    filledFields: ["email"],
    questionsAnswered: ["q1"],
    resumeUploaded: true,
    cvPdfPath: "",
    extraFields: 0,
    steps: [],
    warnings: [],
    screenshotDir: "",
    linkedInApplyMode: "easy_apply",
    ...partial,
  };
}

// Success: reached review
assert.equal(
  dryRunCompletedSuccessfully(
    mockResult({
      steps: [
        { step: 1, action: "clicked_easy_apply" },
        { step: 2, action: "filled_form" },
        { step: 3, action: "dry_run_reached_review" },
        { step: 4, action: "dry_run_complete" },
      ],
    })
  ),
  true
);
assert.equal(
  shouldRecordApplication(
    mockResult({
      steps: [
        { step: 1, action: "clicked_easy_apply" },
        { step: 2, action: "filled_form" },
        { step: 3, action: "dry_run_reached_review" },
        { step: 4, action: "dry_run_complete" },
      ],
    }),
    true,
    { linkedInEasyApplyOnly: true }
  ),
  true
);

// Success: reached review even when LinkedIn pre-filled contact (no tracked field fills)
assert.equal(
  dryRunCompletedSuccessfully(
    mockResult({
      filledFields: [],
      questionsAnswered: [],
      resumeUploaded: false,
      steps: [
        { step: 1, action: "clicked_easy_apply" },
        { step: 2, action: "clicked_easy_apply_next" },
        { step: 3, action: "dry_run_reached_review" },
        { step: 4, action: "dry_run_complete" },
      ],
    })
  ),
  true
);

// Failure: validation / manual review
assert.equal(
  dryRunCompletedSuccessfully(
    mockResult({
      needsManualReview: true,
      steps: [
        { step: 1, action: "clicked_easy_apply" },
        { step: 2, action: "dry_run_complete" },
      ],
    })
  ),
  false
);

// Failure: easy apply button missing
assert.equal(
  dryRunCompletedSuccessfully(
    mockResult({
      steps: [{ step: 1, action: "easy_apply_button_not_found" }],
      filledFields: [],
      questionsAnswered: [],
      resumeUploaded: false,
    })
  ),
  false
);

const successOutcome = automationOutcomeMessage(
  mockResult({
    steps: [
      { step: 1, action: "clicked_easy_apply" },
      { step: 2, action: "filled_form" },
      { step: 3, action: "dry_run_reached_review" },
      { step: 4, action: "dry_run_complete" },
    ],
  }),
  true
);
assert.equal(successOutcome.status, "success");
assert.match(successOutcome.message, /marked as applied/i);

const incompleteDryRun = automationOutcomeMessage(
  mockResult({
    needsManualReview: true,
    warnings: ["Dry run could not reach Review — Please make a selection"],
    steps: [
      { step: 1, action: "clicked_easy_apply" },
      { step: 2, action: "dry_run_complete" },
    ],
  }),
  true
);
assert.equal(incompleteDryRun.status, "skipped");
assert.match(incompleteDryRun.message, /selection|try again|incomplete/i);

const indeedInfoOnly = automationOutcomeMessage(
  mockResult({
    warnings: ["Indeed Smart Apply — filling the application on smartapply.indeed.com."],
    steps: [
      { step: 1, action: "clicked_indeed_apply" },
      { step: 2, action: "clicked_indeed_continue" },
    ],
  }),
  true
);
assert.equal(indeedInfoOnly.status, "skipped");
assert.ok(!/filling the application on smartapply/i.test(indeedInfoOnly.message));
assert.match(indeedInfoOnly.message, /advanced|incomplete|Submit/i);

console.log("finalizeApplication tests: all passed");
