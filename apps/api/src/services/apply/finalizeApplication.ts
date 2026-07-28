import type { ApplyAutomationResult } from "@jobfinder/shared";

const FAILURE_STEP_ACTIONS = [
  "easy_apply_button_not_found",
  "indeed_apply_button_not_found",
  "apply_not_found",
  "apply_button_not_found",
  "external_apply_link_not_found",
  "submit_not_found",
] as const;

const PROGRESS_STEP_ACTIONS = [
  "clicked_easy_apply",
  "clicked_indeed_apply",
  "clicked_easy_apply_next",
  "clicked_indeed_continue",
  "filled_form",
  "uploaded_cv_pdf",
  "dry_run_reached_review",
  "dry_run_complete",
  "submitted_easy_apply",
  "submitted_indeed_apply",
  "submitted",
] as const;

export function automationIndicatesSubmit(result: ApplyAutomationResult): boolean {
  if (result.submitted) return true;
  return result.steps.some((s) =>
    ["submitted_easy_apply", "submitted_indeed_apply", "submitted"].includes(s.action)
  );
}

function hasProgress(result: ApplyAutomationResult): boolean {
  return result.steps.some((s) =>
    (PROGRESS_STEP_ACTIONS as readonly string[]).includes(s.action)
  );
}

function hasFatalFailure(result: ApplyAutomationResult): boolean {
  return result.steps.some((s) =>
    (FAILURE_STEP_ACTIONS as readonly string[]).includes(s.action)
  );
}

/** Dry run finished the apply wizard through Review/Submit (did not submit to the job board). */
export function dryRunCompletedSuccessfully(result: ApplyAutomationResult): boolean {
  if (!result.dryRun) return false;
  if (hasFatalFailure(result)) return false;

  const openedIndeed = result.steps.some((s) => s.action === "clicked_indeed_apply");
  const openedLinkedIn = result.steps.some((s) => s.action === "clicked_easy_apply");
  if (!openedIndeed && !openedLinkedIn) return false;

  const reachedReview = result.steps.some((s) => s.action === "dry_run_reached_review");
  if (reachedReview && !result.needsManualReview) {
    return true;
  }

  if (!hasProgress(result) || result.needsManualReview) return false;

  if (openedIndeed) {
    const reachedSubmit = result.steps.some((s) => s.action === "dry_run_reached_review");
    const continueSteps = result.steps.filter((s) => s.action === "clicked_indeed_continue").length;
    if (reachedSubmit) return true;
    if (
      continueSteps >= 1 &&
      result.steps.some((s) => s.action === "clicked_indeed_apply") &&
      !hasFatalFailure(result)
    ) {
      return result.steps.some((s) => s.action === "dry_run_complete");
    }
  }

  const didWork =
    result.filledFields.length > 0 ||
    result.questionsAnswered.length > 0 ||
    result.resumeUploaded ||
    result.steps.some((s) =>
      [
        "filled_form",
        "uploaded_cv_pdf",
        "clicked_easy_apply_next",
        "clicked_indeed_continue",
      ].includes(s.action)
    );

  return result.steps.some((s) => s.action === "dry_run_complete") && didWork;
}

/** Live run should mark the job applied. */
export function shouldRecordLiveApplication(
  result: ApplyAutomationResult,
  dryRun: boolean,
  options?: { linkedInEasyApplyOnly?: boolean; indeedEasyApplyOnly?: boolean }
): boolean {
  if (dryRun) return false;
  if (automationIndicatesSubmit(result)) return true;
  if (options?.linkedInEasyApplyOnly && result.linkedInApplyMode === "easy_apply") {
    return result.steps.some((s) =>
      ["submitted_easy_apply", "submitted"].includes(s.action)
    );
  }
  if (options?.indeedEasyApplyOnly) {
    return result.steps.some((s) =>
      ["submitted_indeed_apply", "submitted"].includes(s.action)
    );
  }
  if (result.needsManualReview) return false;
  return result.steps.some((s) =>
    [
      "clicked_easy_apply",
      "clicked_indeed_apply",
      "clicked_easy_apply_next",
      "clicked_indeed_continue",
      "filled_form",
      "uploaded_cv_pdf",
      "submitted_easy_apply",
      "submitted_indeed_apply",
      "submitted",
    ].includes(s.action)
  );
}

/** Dry run or live — whether to mark applied in JobFinder and Applied tab. */
export function shouldRecordApplication(
  result: ApplyAutomationResult,
  dryRun: boolean,
  options?: { linkedInEasyApplyOnly?: boolean; indeedEasyApplyOnly?: boolean }
): boolean {
  if (result.steps.some((s) => s.action === "already_applied_on_linkedin")) return true;
  if (dryRun) return dryRunCompletedSuccessfully(result);
  return shouldRecordLiveApplication(result, dryRun, options);
}

const INFORMATIONAL_APPLY_WARNING =
  /Indeed Smart Apply — filling|Opening Indeed in browser|Cloudflare (access )?saved|Cloudflare cleared|Warming session/i;

function pickDryRunFailureMessage(result: ApplyAutomationResult): string {
  const actionable = result.warnings.find(
    (w) =>
      /review|validation|decimal|selection|required|make a selection|could not reach|submit/i.test(
        w
      ) && !INFORMATIONAL_APPLY_WARNING.test(w)
  );
  if (actionable?.trim()) return actionable.trim();

  const other = result.warnings.find(
    (w) => !INFORMATIONAL_APPLY_WARNING.test(w) && !/filling the in-page application form/i.test(w)
  );
  if (other?.trim()) return other.trim();

  if (result.steps.some((s) => s.action === "indeed_apply_button_not_found")) {
    return "Apply with Indeed button not found — sign in via Set up Indeed login, then retry.";
  }
  if (hasFatalFailure(result)) {
    return "Dry run could not open the apply flow — check login, Cloudflare unlock, and try again.";
  }
  if (result.steps.some((s) => s.action === "dry_run_reached_review")) {
    return "Dry run reached review but did not finish — scroll to Submit and run again.";
  }
  const continued = result.steps.filter((s) => s.action === "clicked_indeed_continue").length;
  if (continued > 0) {
    return `Dry run advanced ${continued} step(s) but did not reach Submit — run again or check screenshots.`;
  }
  return "Dry run incomplete — check the apply browser window and screenshots, then run again.";
}

function isIndeedAutomation(result: ApplyAutomationResult): boolean {
  return result.steps.some((s) =>
    ["clicked_indeed_apply", "clicked_indeed_continue", "submitted_indeed_apply"].includes(
      s.action
    )
  );
}

export function applicationRecordNote(
  result: ApplyAutomationResult,
  dryRun: boolean,
  linkedInEasyApplyOnly?: boolean,
  indeedEasyApplyOnly?: boolean
): string {
  if (dryRun) {
    if (dryRunCompletedSuccessfully(result)) {
      return isIndeedAutomation(result)
        ? "Dry run completed — Indeed Smart Apply reached Submit (not submitted on Indeed)"
        : "Dry run completed — Easy Apply filled through Review (not submitted on LinkedIn)";
    }
    return "Dry run attempted — did not complete";
  }
  if (indeedEasyApplyOnly || isIndeedAutomation(result)) {
    return automationIndicatesSubmit(result)
      ? "Submitted via Indeed Smart Apply automation"
      : "Indeed Smart Apply automation run";
  }
  if (linkedInEasyApplyOnly) {
    return automationIndicatesSubmit(result)
      ? "Submitted via LinkedIn Easy Apply automation"
      : "Easy Apply automation run";
  }
  return automationIndicatesSubmit(result)
    ? "Submitted via browser automation"
    : "Browser automation run";
}

/** Outcome label for logs and UI. */
export function automationOutcomeMessage(
  result: ApplyAutomationResult,
  dryRun: boolean
): { status: "success" | "failed" | "skipped"; message: string } {
  if (result.steps.some((s) => s.action === "already_applied_on_linkedin")) {
    return {
      status: "success",
      message: "Already applied on LinkedIn — marked as applied in JobFinder",
    };
  }

  if (dryRun) {
    if (dryRunCompletedSuccessfully(result)) {
      return {
        status: "success",
        message: isIndeedAutomation(result)
          ? "Dry run completed — marked as applied (not sent to Indeed)"
          : "Dry run completed — marked as applied (not sent to LinkedIn)",
      };
    }
    const hint = pickDryRunFailureMessage(result);
    if (result.steps.some((s) => s.action === "already_applied_on_linkedin")) {
      return {
        status: "skipped",
        message: "Already applied on LinkedIn — no dry run needed",
      };
    }
    if (hasFatalFailure(result)) {
      return {
        status: "skipped",
        message:
          hint?.trim() ||
          "Easy Apply could not be opened — check LinkedIn login and try again",
      };
    }
    return {
      status: "skipped",
      message:
        hint?.trim() ||
        "Dry run incomplete — check the form in the browser, then run again",
    };
  }

  const submitted = automationIndicatesSubmit(result);
  if (submitted) {
    return { status: "success", message: "Application submitted" };
  }
  if (result.needsManualReview) {
    return {
      status: "skipped",
      message: "Needs manual review — check browser or screenshots",
    };
  }
  if (hasFatalFailure(result)) {
    return { status: "failed", message: "Apply automation failed" };
  }
  return { status: "failed", message: "Automation finished with issues" };
}
