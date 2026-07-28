import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { ApplyAutomationResult, ApplyAutomationStep, LinkedInApplyMode } from "@jobfinder/shared";
import type { ApplyContext } from "./types.js";
import { JobModel } from "../../models/Job.js";
import { finalizeLiveApplication } from "../versionTracking.js";
import {
  AuthRequiredError,
  collectOpenPages,
  isAuthPageDeep,
  waitForUserLogin,
} from "./authDetection.js";
import {
  CloudflareChallengeError,
  isCloudflareChallengePage,
  solveCloudflareChallenge,
} from "./cloudflareDetection.js";
import { forceReleaseAutomationBrowserLock } from "./browserLock.js";
import { launchAutomationContext } from "./browserSession.js";
import { uploadCvPdf } from "./fileUpload.js";
import { fillEmptyTextareas, fillKnownFields } from "./formFiller.js";
import {
  answerScreeningQuestions,
  ensureEasyApplyStepComplete,
  forceCompleteCurrentEasyApplyStep,
  resolveFormValidationWithAi,
} from "./questionFiller.js";
import {
  clickLinkedInEasyApply,
  clickLinkedInEasyApplyNext,
  clickLinkedInReviewButton,
  clickLinkedInEasyApplySubmit,
  detectLinkedInApplicationSubmitted,
  detectLinkedInJobAlreadyApplied,
  dismissLinkedInPostApplyDialog,
  isLinkedInEasyApplyAtReviewOrSubmit,
  isLinkedInEasyApplyReviewSummary,
  linkedInEasyApplyModal,
  openCompanyApplyFromLinkedIn,
  resolveLinkedInApplication,
} from "./linkedinApply.js";
import {
  clickIndeedContinue,
  clickIndeedEasyApply,
  clickIndeedSubmit,
  detectIndeedApplicationSubmitted,
  detectIndeedApplyMode,
  isIndeedSmartApplyUrl,
  prepareIndeedSmartApplyStep,
  finalizeIndeedReviewStep,
  runIndeedSmartApplyUntilSubmit,
  scrollIndeedSmartApplyToActions,
} from "./indeedApply.js";
import { clickApplyEntry, clickNextStep, clickSubmit, pickFormPage } from "./navigation.js";
import {
  hasUnfilledEasyApplyRequiredFields,
  hasVisibleValidationErrors,
} from "./discoverFormQuestions.js";
import { getActiveApplyTiming, resolveApplyTiming, setActiveApplyTiming } from "./applyTiming.js";
import { dismissCookieBanners, waitForFormStability } from "./pageUtils.js";
import { safeScreenshot, safeWait } from "./safePage.js";

async function ensureNotStuckOnAuth(
  pages: Page[],
  headless: boolean,
  warnings: string[],
  targetUrl?: string
): Promise<void> {
  const needsCf = [];
  for (const p of pages) {
    try {
      if (!p.isClosed() && (await isCloudflareChallengePage(p))) needsCf.push(p);
    } catch {
      /* closed */
    }
  }
  if (needsCf.length > 0) {
    warnings.push("Cloudflare detected — completing verification, then loading the job page…");
    const cleared = await solveCloudflareChallenge(pages, 180_000, { targetUrl });
    if (!cleared) {
      throw new CloudflareChallengeError();
    }
    warnings.push("Cloudflare cleared — continuing to Indeed apply.");
  }

  const authUrls: string[] = [];
  for (const p of pages) {
    try {
      if (!p.isClosed() && (await isAuthPageDeep(p))) authUrls.push(p.url());
    } catch {
      /* closed */
    }
  }
  if (authUrls.length === 0) return;

  if (headless) {
    throw new AuthRequiredError(authUrls);
  }

  warnings.push(
    "Sign-in page detected — complete Google or LinkedIn login in the browser (up to 3 minutes)."
  );
  const ok = await waitForUserLogin(pages, 180_000);
  if (!ok) {
    throw new AuthRequiredError(authUrls);
  }
}

/** Fill each step and advance until LinkedIn shows the Review / Submit summary. */
async function advanceEasyApplyToReviewSummary(
  formPage: Page,
  ctx: ApplyContext,
  aiQuestionCtx: {
    jobTitle: string;
    company: string;
    jobDescription: string;
    resumeText: string;
    coverLetter: string;
    profile: ApplyContext["profile"];
  },
  timing: ReturnType<typeof getActiveApplyTiming>,
  steps: ApplyAutomationStep[],
  detailTag: string
): Promise<boolean> {
  const completeStep = async (): Promise<boolean> => {
    let ok = await forceCompleteCurrentEasyApplyStep(
      formPage,
      aiQuestionCtx,
      ctx.screeningAnswers,
      ctx.coverLetter,
      timing.dryRunFixPasses
    );
    if (!ok) {
      await resolveFormValidationWithAi(formPage, aiQuestionCtx);
      ok = await forceCompleteCurrentEasyApplyStep(
        formPage,
        aiQuestionCtx,
        ctx.screeningAnswers,
        ctx.coverLetter,
        2
      );
    }
    return ok;
  };

  let reachedReview = await isLinkedInEasyApplyReviewSummary(formPage);

  for (let pass = 0; !reachedReview && pass < timing.dryRunAdvancePasses; pass++) {
    await completeStep();

    if (await isLinkedInEasyApplyReviewSummary(formPage)) {
      reachedReview = true;
      break;
    }

    if (await isLinkedInEasyApplyAtReviewOrSubmit(formPage)) {
      await clickLinkedInReviewButton(formPage);
      await safeWait(formPage, timing.formStabilityMs);
      reachedReview = await isLinkedInEasyApplyReviewSummary(formPage);
      if (reachedReview) {
        steps.push({
          step: steps.length + 1,
          action: "clicked_easy_apply_next",
          detail: `${detailTag}_review`,
        });
      }
      break;
    }

    await completeStep();

    const advanced = await clickLinkedInEasyApplyNext(formPage);
    if (!advanced) break;
    steps.push({
      step: steps.length + 1,
      action: "clicked_easy_apply_next",
      detail: `${detailTag}_advance`,
    });
    await waitForFormStability(formPage);
    reachedReview = await isLinkedInEasyApplyReviewSummary(formPage);
  }

  if (!reachedReview && (await isLinkedInEasyApplyAtReviewOrSubmit(formPage))) {
    await completeStep();
    await clickLinkedInReviewButton(formPage);
    await safeWait(formPage, timing.formStabilityMs);
    reachedReview = await isLinkedInEasyApplyReviewSummary(formPage);
  }

  return reachedReview;
}

async function runFillLoop(
  formPage: Page,
  ctx: ApplyContext,
  steps: ApplyAutomationStep[],
  warnings: string[],
  allFilled: Set<string>,
  allAnswered: Set<string>,
  screenshotDir: string
): Promise<{ extraFields: number; resumeUploaded: boolean }> {
  let extraFields = 0;
  let resumeUploaded = false;

  const { maxFormSteps, captureStepScreenshots } = getActiveApplyTiming();

  for (let round = 0; round < maxFormSteps; round++) {
    const stepNum = steps.length + 1;
    await dismissCookieBanners(formPage);
    await ensureNotStuckOnAuth(await collectOpenPages(formPage), ctx.headless, warnings);

    const filled = await fillKnownFields(formPage, ctx.coverLetter, ctx.profile);
    filled.forEach((f) => allFilled.add(f));

    const aiQuestionCtx = {
      jobTitle: ctx.jobTitle,
      company: ctx.company,
      jobDescription: ctx.jobDescription,
      resumeText: ctx.resumeText,
      coverLetter: ctx.coverLetter,
      profile: ctx.profile,
    };

    const useAi = ctx.resumeText.trim() && !ctx.dryRun;
    let answered: string[] = [];
    if (useAi) {
      answered = await answerScreeningQuestions(
        formPage,
        ctx.screeningAnswers,
        ctx.coverLetter,
        aiQuestionCtx
      );
      answered.forEach((a) => allAnswered.add(a));
    } else {
      answered = await answerScreeningQuestions(
        formPage,
        ctx.screeningAnswers,
        ctx.coverLetter,
        undefined
      );
      answered.forEach((a) => allAnswered.add(a));
    }

    await forceCompleteCurrentEasyApplyStep(
      formPage,
      aiQuestionCtx,
      ctx.screeningAnswers,
      ctx.coverLetter,
      getActiveApplyTiming().dryRunFixPasses
    );

    if (useAi && (await hasVisibleValidationErrors(formPage))) {
      const validationFixed = await resolveFormValidationWithAi(formPage, aiQuestionCtx);
      validationFixed.forEach((a) => allAnswered.add(a));
      await forceCompleteCurrentEasyApplyStep(
        formPage,
        aiQuestionCtx,
        ctx.screeningAnswers,
        ctx.coverLetter,
        2
      );
    }

    extraFields += await fillEmptyTextareas(formPage, ctx.coverLetter);

    if (!resumeUploaded) {
      resumeUploaded = await uploadCvPdf(formPage, ctx.cvPdfPath);
      if (resumeUploaded) {
        steps.push({ step: stepNum, action: "uploaded_cv_pdf" });
      }
    }

    steps.push({
      step: stepNum,
      action: "filled_form",
      detail: `fields=${filled.join(",") || "none"} questions=${answered.join(",") || "none"}`,
    });

    if (captureStepScreenshots) {
      await formPage.screenshot({
        path: path.join(screenshotDir, `step-${round + 1}.png`),
        fullPage: true,
      });
    }

    let inEasyApplyModal = (await linkedInEasyApplyModal(formPage).count()) > 0;
    if (!inEasyApplyModal && ctx.linkedInEasyApplyOnly) {
      await linkedInEasyApplyModal(formPage)
        .waitFor({ state: "visible", timeout: 12_000 })
        .catch(() => undefined);
      inEasyApplyModal = (await linkedInEasyApplyModal(formPage).count()) > 0;
    }
    const indeedSmartApply = isIndeedSmartApplyUrl(formPage.url());
    const easyApplyStep =
      inEasyApplyModal || !!ctx.linkedInEasyApplyOnly || indeedSmartApply || !!ctx.indeedEasyApplyOnly;

    if (easyApplyStep && (await isLinkedInEasyApplyReviewSummary(formPage))) {
      break;
    }
    if (
      easyApplyStep &&
      (await isLinkedInEasyApplyAtReviewOrSubmit(formPage)) &&
      !(await isLinkedInEasyApplyReviewSummary(formPage))
    ) {
      await clickLinkedInReviewButton(formPage);
      await waitForFormStability(formPage);
      break;
    }

    let advanced = false;
    if (indeedSmartApply) {
      await prepareIndeedSmartApplyStep(formPage);
      advanced = await clickIndeedContinue(formPage);
      if (!advanced) {
        advanced = await clickNextStep(formPage);
      }
    } else if (easyApplyStep) {
      const stepReady = await forceCompleteCurrentEasyApplyStep(
        formPage,
        aiQuestionCtx,
        ctx.screeningAnswers,
        ctx.coverLetter,
        getActiveApplyTiming().dryRunFixPasses
      );
      if (stepReady) {
        if (await isLinkedInEasyApplyAtReviewOrSubmit(formPage)) {
          advanced = await clickLinkedInReviewButton(formPage);
        } else {
          advanced =
            (await clickLinkedInEasyApplyNext(formPage)) || (await clickNextStep(formPage));
        }
      } else {
        advanced =
          (await clickLinkedInEasyApplyNext(formPage)) || (await clickNextStep(formPage));
        if (advanced) {
          warnings.push("Advanced with validation warnings — completing fields on next step.");
        } else {
          warnings.push(
            "Easy Apply step still has required fields — could not click Next."
          );
        }
      }
    } else {
      advanced =
        (await clickLinkedInEasyApplyNext(formPage)) || (await clickNextStep(formPage));
    }
    if (advanced) {
      steps.push({
        step: stepNum,
        action: indeedSmartApply
          ? "clicked_indeed_continue"
          : easyApplyStep
            ? "clicked_easy_apply_next"
            : "clicked_next",
      });
      await waitForFormStability(formPage);
      continue;
    }
    break;
  }

  return { extraFields, resumeUploaded };
}

function buildEarlyResult(
  ctx: ApplyContext,
  partial: {
    steps: ApplyAutomationStep[];
    warnings: string[];
    linkedInApplyMode?: LinkedInApplyMode;
    applicationUrlUsed?: string;
    allFilled: Set<string>;
    allAnswered: Set<string>;
  }
): ApplyAutomationResult {
  return {
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    submitted: false,
    needsManualReview: true,
    filledFields: [...partial.allFilled],
    questionsAnswered: [...partial.allAnswered],
    resumeUploaded: false,
    cvPdfPath: ctx.cvPdfPath,
    extraFields: 0,
    steps: partial.steps,
    warnings: partial.warnings,
    screenshotDir: ctx.screenshotDir,
    linkedInApplyMode: partial.linkedInApplyMode,
    applicationUrlUsed: partial.applicationUrlUsed,
  };
}

export async function runApplicationAutomation(ctx: ApplyContext): Promise<ApplyAutomationResult> {
  setActiveApplyTiming(
    resolveApplyTiming(ctx.profile, ctx.linkedInEasyApplyOnly, ctx.indeedEasyApplyOnly)
  );
  const timing = getActiveApplyTiming();

  const steps: ApplyAutomationStep[] = [];
  const warnings: string[] = [];
  const allFilled = new Set<string>();
  const allAnswered = new Set<string>();
  let linkedInApplyMode: LinkedInApplyMode | undefined;
  let indeedApplyMode: "easy_apply" | "external" | "unknown" | undefined;
  let applicationUrlUsed: string | undefined;

  await fs.mkdir(ctx.screenshotDir, { recursive: true });

  const preopened = ctx.preopenedBrowser;
  const { page, close } = preopened ?? (await launchAutomationContext(ctx.headless));
  let submitted = false;

  try {
    const isIndeedNav =
      ctx.indeedEasyApplyOnly || /indeed\.com/i.test(ctx.url);

    if (!preopened) {
      steps.push({ step: 1, action: "navigate", detail: ctx.url });
      if (isIndeedNav) {
        const { navigateIndeedJobWithSession } = await import("./indeedSession.js");
        await navigateIndeedJobWithSession(page, ctx.url);
      } else {
        await page.goto(ctx.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      }
    } else {
      steps.push({ step: 1, action: "navigate", detail: `${ctx.url} (pre-opened)` });
    }
    await waitForFormStability(page);
    await dismissCookieBanners(page);
    await ensureNotStuckOnAuth([page], ctx.headless, warnings, ctx.url);

    let formPage = page;
    const isLinkedInJob = /linkedin\.com\/jobs/i.test(ctx.url);
    const isIndeedJob =
      ctx.indeedEasyApplyOnly || /indeed\.com/i.test(ctx.url) || isIndeedSmartApplyUrl(page.url());

    if (isLinkedInJob && (await detectLinkedInJobAlreadyApplied(page))) {
      warnings.push("LinkedIn shows this job is already applied — skipping.");
      steps.push({ step: 2, action: "already_applied_on_linkedin" });
      await finalizeLiveApplication(
        ctx.jobId,
        "Already applied on LinkedIn (detected on job page)"
      );
      return {
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        submitted: false,
        needsManualReview: false,
        filledFields: [],
        questionsAnswered: [],
        resumeUploaded: false,
        cvPdfPath: ctx.cvPdfPath,
        extraFields: 0,
        steps,
        warnings,
        screenshotDir: ctx.screenshotDir,
        linkedInApplyMode: "easy_apply",
        applicationUrlUsed: page.url(),
      };
    }

    if (isLinkedInJob) {
      const resolved = await resolveLinkedInApplication(page, ctx.url);
      linkedInApplyMode = resolved.mode;
      applicationUrlUsed = resolved.companyApplyUrl ?? resolved.url;
      let easyApplyAlreadyClicked = false;

      steps.push({
        step: 2,
        action: "linkedin_apply_mode",
        detail: resolved.mode,
      });

      if (ctx.linkedInEasyApplyOnly && resolved.mode !== "easy_apply") {
        const clickedAnyway = await clickLinkedInEasyApply(page);
        if (clickedAnyway) {
          linkedInApplyMode = "easy_apply";
          resolved.mode = "easy_apply";
          easyApplyAlreadyClicked = true;
          steps.push({ step: 3, action: "clicked_easy_apply" });
          warnings.push("LinkedIn Easy Apply — filling the in-page application form.");
          await waitForFormStability(page);
          formPage = page;
        } else {
          if (resolved.mode === "external" || resolved.mode === "unknown") {
            await JobModel.findByIdAndUpdate(ctx.jobId, {
              linkedInApplyType: resolved.mode === "external" ? "external" : "unknown",
            });
          }
          warnings.push(
            resolved.mode === "external"
              ? "This job uses Apply on the company website, not LinkedIn Easy Apply. It was removed from the Auto Apply list."
              : "Could not confirm LinkedIn Easy Apply on this job page. Try again after signing in to LinkedIn."
          );
          return buildEarlyResult(ctx, {
            steps,
            warnings,
            linkedInApplyMode,
            applicationUrlUsed,
            allFilled,
            allAnswered,
          });
        }
      }

      if (resolved.mode === "external") {
        warnings.push(
          "This is not LinkedIn Easy Apply — automation opens the company career site instead."
        );

        const companyUrl = resolved.companyApplyUrl;
        if (companyUrl) {
          steps.push({ step: 3, action: "open_company_apply_url", detail: companyUrl });
          await page.goto(companyUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
          await waitForFormStability(page);
          await dismissCookieBanners(page);
          applicationUrlUsed = page.url();
        } else {
          const opened = await openCompanyApplyFromLinkedIn(page);
          if (opened.opened) {
            steps.push({
              step: 3,
              action: "clicked_company_apply",
              detail: opened.targetUrl ?? page.url(),
            });
            formPage = await pickFormPage(page, opened.popup ?? undefined);
            applicationUrlUsed = formPage.url();
          } else {
            warnings.push(
              "Could not find the company apply link on LinkedIn. Open the job posting and apply manually, or collect jobs from Indeed for better automation support."
            );
            await page.screenshot({
              path: path.join(ctx.screenshotDir, "linkedin_external_no_url.png"),
              fullPage: true,
            });
            steps.push({ step: 3, action: "external_apply_link_not_found" });
            return buildEarlyResult(ctx, {
              steps,
              warnings,
              linkedInApplyMode,
              applicationUrlUsed,
              allFilled,
              allAnswered,
            });
          }
        }
        await ensureNotStuckOnAuth(await collectOpenPages(page), ctx.headless, warnings);
        formPage = page;
      } else if (resolved.mode === "easy_apply") {
        if (!easyApplyAlreadyClicked) {
          warnings.push("LinkedIn Easy Apply — filling the in-page application form.");
          const clicked = await clickLinkedInEasyApply(page);
          steps.push({
            step: 3,
            action: clicked ? "clicked_easy_apply" : "easy_apply_button_not_found",
          });
          if (!clicked) {
            warnings.push(
              "Easy Apply button not found. The listing may have changed — try again or apply manually."
            );
            return buildEarlyResult(ctx, {
              steps,
              warnings,
              linkedInApplyMode,
              applicationUrlUsed,
              allFilled,
              allAnswered,
            });
          }
          await waitForFormStability(page);
          await linkedInEasyApplyModal(page)
            .waitFor({ state: "visible", timeout: 15_000 })
            .catch(() => undefined);
        }
        formPage = page;
      } else {
        warnings.push(
          "Could not detect Easy Apply vs external. Trying company URL if available, otherwise manual apply."
        );
        if (resolved.companyApplyUrl) {
          await page.goto(resolved.companyApplyUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
          applicationUrlUsed = page.url();
        } else {
          const { clicked, popup } = await clickApplyEntry(page);
          steps.push({
            step: 3,
            action: clicked ? "clicked_apply_fallback" : "apply_not_found",
          });
          formPage = await pickFormPage(page, popup ?? undefined);
        }
        await ensureNotStuckOnAuth(await collectOpenPages(page), ctx.headless, warnings);
      }
    } else if (isIndeedJob) {
      const { waitForIndeedJobPage } = await import("./indeedApply.js");
      if (!isIndeedSmartApplyUrl(page.url())) {
        await waitForIndeedJobPage(page, ctx.url);
      }
      indeedApplyMode = await detectIndeedApplyMode(page);
      steps.push({
        step: 2,
        action: "indeed_apply_mode",
        detail: indeedApplyMode,
      });

      if (ctx.indeedEasyApplyOnly && indeedApplyMode === "external") {
        await JobModel.findByIdAndUpdate(ctx.jobId, { indeedApplyType: "external" });
        warnings.push(
          "This job uses Apply on the company website, not Indeed Smart Apply. It was removed from the Auto Apply Indeed list."
        );
        return buildEarlyResult(ctx, {
          steps,
          warnings,
          linkedInApplyMode,
          applicationUrlUsed: page.url(),
          allFilled,
          allAnswered,
        });
      }

      if (indeedApplyMode === "easy_apply" || ctx.indeedEasyApplyOnly) {
        const clicked = await clickIndeedEasyApply(page);
        steps.push({
          step: 3,
          action: clicked ? "clicked_indeed_apply" : "indeed_apply_button_not_found",
          detail: clicked ? "Indeed Smart Apply (smartapply.indeed.com)" : undefined,
        });
        if (!clicked) {
          warnings.push(
            "Apply with Indeed button not found. Sign in via Set up Indeed login, then try again."
          );
          return buildEarlyResult(ctx, {
            steps,
            warnings,
            linkedInApplyMode,
            applicationUrlUsed: page.url(),
            allFilled,
            allAnswered,
          });
        }
        applicationUrlUsed = page.url();
        await waitForFormStability(page);
        formPage = page;
      } else if (indeedApplyMode === "external") {
        warnings.push("Indeed external apply — opening the company application flow.");
        const { clicked, popup } = await clickApplyEntry(page);
        steps.push({
          step: 3,
          action: clicked ? "clicked_company_apply" : "apply_button_not_found",
        });
        formPage = await pickFormPage(page, popup ?? undefined);
        applicationUrlUsed = formPage.url();
        await ensureNotStuckOnAuth(await collectOpenPages(page), ctx.headless, warnings);
      } else {
        const { clicked, popup } = await clickApplyEntry(page);
        steps.push({
          step: 3,
          action: clicked ? "clicked_apply" : "apply_button_not_found",
        });
        formPage = await pickFormPage(page, popup ?? undefined);
        applicationUrlUsed = formPage.url();
        await ensureNotStuckOnAuth(await collectOpenPages(page), ctx.headless, warnings);
      }
    } else {
      const { clicked, popup } = await clickApplyEntry(page);
      steps.push({
        step: 2,
        action: clicked ? "clicked_apply" : "apply_button_not_found",
      });
      await waitForFormStability(page);
      await ensureNotStuckOnAuth(await collectOpenPages(page), ctx.headless, warnings);
      formPage = await pickFormPage(page, popup ?? undefined);
    }

    const skipFillLoopForIndeedDryRun =
      ctx.dryRun &&
      (isIndeedSmartApplyUrl(formPage.url()) || indeedApplyMode === "easy_apply") &&
      !linkedInApplyMode;

    const { extraFields, resumeUploaded } = skipFillLoopForIndeedDryRun
      ? { extraFields: 0, resumeUploaded: false }
      : await runFillLoop(
          formPage,
          ctx,
          steps,
          warnings,
          allFilled,
          allAnswered,
          ctx.screenshotDir
        );

    await safeScreenshot(formPage, {
      path: path.join(ctx.screenshotDir, "before_submit.png"),
      fullPage: true,
    });

    let needsManualReview =
      linkedInApplyMode === "external" || indeedApplyMode === "external";

    const aiQuestionCtx = {
      jobTitle: ctx.jobTitle,
      company: ctx.company,
      jobDescription: ctx.jobDescription,
      resumeText: ctx.resumeText,
      coverLetter: ctx.coverLetter,
      profile: ctx.profile,
    };

    const onIndeedSmartApply =
      isIndeedSmartApplyUrl(formPage.url()) || indeedApplyMode === "easy_apply";

    if (ctx.dryRun && onIndeedSmartApply && !linkedInApplyMode) {
      const smart = await runIndeedSmartApplyUntilSubmit(formPage, {
        coverLetter: ctx.coverLetter,
        profile: ctx.profile,
        screeningAnswers: ctx.screeningAnswers,
        cvPdfPath: ctx.cvPdfPath,
        resumeText: ctx.resumeText,
        maxPasses: timing.dryRunAdvancePasses,
        tryUploadCv: Boolean(ctx.cvPdfPath),
      });
      for (let i = 0; i < smart.continueClicks; i++) {
        steps.push({
          step: steps.length + 1,
          action: "clicked_indeed_continue",
          detail: `step_${i + 1}`,
        });
      }
      if (smart.resumeUploaded) {
        steps.push({ step: steps.length + 1, action: "uploaded_cv_pdf" });
      }
      steps.push({
        step: steps.length + 1,
        action: "filled_form",
        detail: `indeed_smartapply continues=${smart.continueClicks} url=${smart.finalUrl} validation=${smart.hasValidation}`,
      });

      if (smart.reachedSubmit) {
        const review = await finalizeIndeedReviewStep(formPage, { clickSubmit: false });
        if (review.foundSubmit) {
          steps.push({ step: steps.length + 1, action: "dry_run_scrolled_to_submit" });
        } else {
          await scrollIndeedSmartApplyToActions(formPage);
        }
        steps.push({ step: steps.length + 1, action: "dry_run_reached_review" });
        needsManualReview = false;
        warnings.push(
          review.foundSubmit
            ? "Dry run complete — review page open with Submit in view (not submitted)."
            : "Dry run complete — reached review on Indeed Smart Apply (not submitted)."
        );
      } else {
        needsManualReview = true;
        warnings.push(
          `Dry run advanced ${smart.continueClicks} step(s) on Indeed — could not reach Submit (${smart.finalUrl}${smart.hasValidation ? ", validation errors remain" : ""}). Check screenshots.`
        );
      }
      await safeScreenshot(formPage, {
        path: path.join(ctx.screenshotDir, "dry_run.png"),
        fullPage: true,
      });
      steps.push({ step: steps.length + 1, action: "dry_run_complete" });
    } else if (ctx.dryRun && linkedInApplyMode === "easy_apply") {
      const reachedReview = await advanceEasyApplyToReviewSummary(
        formPage,
        ctx,
        aiQuestionCtx,
        timing,
        steps,
        "dry_run"
      );

      if (reachedReview) {
        steps.push({ step: steps.length + 1, action: "dry_run_reached_review" });
        needsManualReview = false;
      } else if (await hasVisibleValidationErrors(formPage)) {
        needsManualReview = true;
        const errHint = await formPage
          .locator(
            ".jobs-easy-apply-modal .artdeco-inline-feedback--error, [role='dialog'] .artdeco-inline-feedback--error"
          )
          .first()
          .innerText()
          .catch(() => "");
        warnings.push(
          errHint.trim()
            ? `Dry run could not reach Review — ${errHint.trim().slice(0, 200)}`
            : "Dry run could not reach Review — fix validation errors or complete manually."
        );
      } else if (
        !allFilled.size &&
        !allAnswered.size &&
        !resumeUploaded &&
        !steps.some((s) => s.action === "clicked_easy_apply_next")
      ) {
        needsManualReview = true;
        warnings.push("Dry run did not fill the Easy Apply form.");
      }

      await safeScreenshot(formPage, {
        path: path.join(ctx.screenshotDir, "dry_run.png"),
        fullPage: true,
      });
      steps.push({ step: steps.length + 1, action: "dry_run_complete" });
      if (reachedReview) {
        warnings.push(
          "Dry run complete — reached Review/submit step. Not submitted on LinkedIn; marked as applied in JobFinder."
        );
      }
    } else if (ctx.dryRun) {
      await safeScreenshot(formPage, {
        path: path.join(ctx.screenshotDir, "dry_run.png"),
        fullPage: true,
      });
      steps.push({ step: steps.length + 1, action: "dry_run_complete" });
      warnings.push("Dry run — form was not submitted. Review screenshots before applying.");
    } else if (linkedInApplyMode === "external") {
      steps.push({ step: steps.length + 1, action: "external_manual_submit_expected" });
      warnings.push("External applications usually need you to click Submit on the company site.");
    } else if (onIndeedSmartApply && !linkedInApplyMode) {
      const smart = await runIndeedSmartApplyUntilSubmit(formPage, {
        coverLetter: ctx.coverLetter,
        profile: ctx.profile,
        screeningAnswers: ctx.screeningAnswers,
        cvPdfPath: ctx.cvPdfPath,
        resumeText: ctx.resumeText,
        maxPasses: timing.dryRunAdvancePasses,
        tryUploadCv: true,
      });
      if (!smart.reachedSubmit) {
        warnings.push("Could not reach Submit on Indeed — trying Submit anyway.");
      }
      await finalizeIndeedReviewStep(formPage, { clickSubmit: false });
      submitted = await clickIndeedSubmit(formPage);
      if (!submitted) submitted = await clickSubmit(formPage);
      if (!submitted) {
        await safeWait(page, timing.linkedInClickDelayMs);
        submitted = await detectIndeedApplicationSubmitted(page);
      }
      steps.push({
        step: steps.length + 1,
        action: submitted ? "submitted_indeed_apply" : "submit_not_found",
      });
      if (!submitted) {
        needsManualReview = true;
        warnings.push("Could not find Submit on Indeed Smart Apply — complete manually.");
      }
    } else if (linkedInApplyMode === "easy_apply") {
      const atReview = await advanceEasyApplyToReviewSummary(
        formPage,
        ctx,
        aiQuestionCtx,
        timing,
        steps,
        "live"
      );
      if (!atReview) {
        warnings.push(
          "Could not reach Review before submit — trying Submit anyway."
        );
      }

      submitted = await clickLinkedInEasyApplySubmit(formPage);
      if (!submitted) submitted = await clickSubmit(formPage);
      if (!submitted) {
        await safeWait(page, timing.linkedInClickDelayMs);
        submitted = await detectLinkedInApplicationSubmitted(page);
      }
      steps.push({
        step: steps.length + 1,
        action: submitted ? "submitted_easy_apply" : "submit_not_found",
      });
      if (submitted) {
        await dismissLinkedInPostApplyDialog(page);
        await safeWait(page, Math.round(timing.linkedInClickDelayMs * 0.75));
      } else {
        needsManualReview = true;
        warnings.push("Could not find Submit in Easy Apply — complete manually.");
      }
    } else {
      submitted = await clickSubmit(formPage);
      steps.push({
        step: steps.length + 1,
        action: submitted ? "submitted" : "submit_not_found",
      });
      if (!submitted) {
        needsManualReview = true;
        warnings.push("Could not find Submit — complete the last step manually.");
      }
    }

    if (!ctx.dryRun && ctx.requireManualSubmit && !submitted) {
      steps.push({ step: steps.length + 1, action: "awaiting_manual_submit" });
      warnings.push("Submit manually in the browser, then mark as applied in JobFinder.");
      await safeWait(page, 120_000);
    }

    return {
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      submitted,
      needsManualReview,
      filledFields: [...allFilled],
      questionsAnswered: [...allAnswered],
      resumeUploaded,
      cvPdfPath: ctx.cvPdfPath,
      extraFields,
      steps,
      warnings,
      screenshotDir: ctx.screenshotDir,
      linkedInApplyMode,
      applicationUrlUsed,
    };
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      await safeScreenshot(page, {
        path: path.join(ctx.screenshotDir, "auth_required.png"),
        fullPage: true,
      });
    }
    if (err instanceof CloudflareChallengeError) {
      await safeScreenshot(page, {
        path: path.join(ctx.screenshotDir, "cloudflare_challenge.png"),
        fullPage: true,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(message);
    await safeScreenshot(page, {
      path: path.join(ctx.screenshotDir, "error.png"),
      fullPage: true,
    });
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      warnings.push("Run: npm run playwright:install -w @jobfinder/api");
    }
    throw err;
  } finally {
    const keepBrowserOpen =
      !ctx.dryRun && ctx.requireManualSubmit && !submitted;
    if (!keepBrowserOpen) {
      try {
        await close();
      } catch {
        forceReleaseAutomationBrowserLock();
      }
    }
    if (!keepBrowserOpen) {
      forceReleaseAutomationBrowserLock();
    }
  }
}
