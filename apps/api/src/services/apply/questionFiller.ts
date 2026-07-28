import type { Page } from "playwright";
import {
  DEFAULT_YEARS_EXPERIENCE,
  generateApplyQuestionAnswers,
  heuristicApplyAnswer,
  isYearsExperienceQuestion,
  matchAnswerToOption,
  normalizeYearsExperienceAnswer,
  type ApplyQuestionContext,
  type ApplyQuestionInput,
} from "../ai/applyQuestions.js";
import { matchScreeningKey } from "./fieldPatterns.js";
import {
  discoverUnfilledFormFields,
  fillAllEmptyLinkedInDropdowns,
  fillAllUncheckedRadioGroups,
  fillDiscoveredField,
  fillNumericInputInQuestionBlock,
  fillRadioInQuestionBlock,
  hasUnfilledEasyApplyRequiredFields,
  hasVisibleValidationErrors,
  type DiscoveredFormField,
} from "./discoverFormQuestions.js";
import { fillKnownLinkedInDropdowns } from "./linkedinDropdownFill.js";
import { fillAllLinkedInRadiosForce } from "./linkedinRadioFill.js";
import { completeIndeedScreeningStep } from "./indeedScreeningFill.js";
import { applicationTargets } from "./pageUtils.js";
import { safeWait } from "./safePage.js";

export function resolveAnswer(
  screeningKey: string,
  screeningAnswers: Record<string, string>,
  coverLetter: string
): string {
  const direct = screeningAnswers[screeningKey]?.trim();
  if (direct) return direct;
  for (const [k, v] of Object.entries(screeningAnswers)) {
    if (k.includes(screeningKey) || screeningKey.includes(k)) {
      if (v?.trim()) return v.trim();
    }
  }
  if (screeningKey === "why_this_role") {
    return coverLetter.split("\n\n")[0]?.slice(0, 500) ?? coverLetter.slice(0, 500);
  }
  if (screeningKey === "years_experience") {
    const years = screeningAnswers.years_experience?.trim();
    if (years) {
      return normalizeYearsExperienceAnswer(years, "years of experience", "number");
    }
    return DEFAULT_YEARS_EXPERIENCE;
  }
  if (screeningKey === "work_authorization" || screeningKey === "located_ireland") {
    return "Yes";
  }
  if (screeningKey === "dublin_resident") {
    return screeningAnswers.dublin_resident?.trim() || "Yes";
  }
  if (screeningKey === "sponsorship") {
    return "No";
  }
  if (screeningKey === "office_attendance") {
    return screeningAnswers.office_attendance?.trim() || "Yes";
  }
  if (screeningKey === "industry_experience") {
    return screeningAnswers.industry_experience?.trim() || "No";
  }
  return "";
}

/** LinkedIn Easy Apply Yes/No radios — one block per question (not parent sections). */
async function fillLinkedInYesNoRadioGroups(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  aiContext?: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];

  if (aiContext) {
    answered.push(...(await fillAllLinkedInRadiosForce(page, aiContext)));
    answered.push(...(await fillAllUncheckedRadioGroups(page, aiContext)));
  }

  const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
  const root = (await modal.count()) > 0 ? modal : page;
  const groups = root.locator(".jobs-easy-apply-form-element, .fb-dash-form-element");
  const count = Math.min(await groups.count(), 40);

  for (let i = 0; i < count; i++) {
    try {
      const group = groups.nth(i);
      const radioCount = await group.locator('input[type="radio"]').count();
      if (radioCount < 2) continue;
      if ((await group.locator('input[type="radio"]:checked').count()) > 0) continue;

      const labelText = ((await group.innerText()) ?? "").slice(0, 500);
      const key = matchScreeningKey(labelText);
      if (!key) continue;

      const answer = resolveAnswer(key, screeningAnswers, coverLetter);
      if (!answer || !/^(yes|no)$/i.test(answer.trim())) continue;

      const resolved = matchAnswerToOption(answer, ["Yes", "No"]);
      const questionLine =
        labelText
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 15 && (l.includes("?") || /authorized|sponsorship|visa/i.test(l))) ??
        labelText;

      if (await fillRadioInQuestionBlock(page, questionLine, resolved)) {
        answered.push(key);
      }
    } catch {
      /* next group */
    }
  }

  return [...new Set(answered)];
}

async function fillKnownScreeningFields(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  aiContext?: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];
  answered.push(
    ...(await fillLinkedInYesNoRadioGroups(page, screeningAnswers, coverLetter, aiContext))
  );

  for (const target of applicationTargets(page)) {
    const fields = target.locator(
      'fieldset, [role="group"], .field, .form-group, label'
    );
    const groupCount = Math.min(await fields.count(), 40);

    for (let g = 0; g < groupCount; g++) {
      try {
        const group = fields.nth(g);
        const labelText = ((await group.innerText()) ?? "").slice(0, 400);
        if (!labelText.trim()) continue;
        const key = matchScreeningKey(labelText);
        if (!key) continue;
        const answer = resolveAnswer(key, screeningAnswers, coverLetter);
        if (!answer) continue;

        const numberInput = group.locator('input[type="number"]').first();
        if ((await numberInput.count()) > 0 && (await numberInput.isVisible())) {
          const cur = await numberInput.inputValue();
          if (!cur.trim()) {
            await numberInput.fill(
              normalizeYearsExperienceAnswer(answer, labelText, "number")
            );
            answered.push(key);
            continue;
          }
        }

        const textarea = group.locator("textarea").first();
        if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
          const cur = await textarea.inputValue();
          if (!cur.trim()) {
            await textarea.fill(answer);
            answered.push(key);
            continue;
          }
        }

        const textInput = group
          .locator(
            'input[type="text"], input[type="number"], input:not([type]), input[type="search"]'
          )
          .first();
        if ((await textInput.count()) > 0 && (await textInput.isVisible())) {
          const cur = await textInput.inputValue();
          if (!cur.trim()) {
            const val =
              key === "years_experience" || isYearsExperienceQuestion(labelText)
                ? normalizeYearsExperienceAnswer(answer, labelText, "number")
                : answer;
            let filled = false;
            if (isYearsExperienceQuestion(labelText)) {
              filled = await fillNumericInputInQuestionBlock(page, labelText, val);
            }
            if (!filled) {
              await textInput.fill(val);
              await textInput.blur().catch(() => undefined);
            }
            answered.push(key);
          }
        }

        if (
          /^(yes|no|true|false)$/i.test(answer.trim()) &&
          !(await group.locator('input[type="radio"]:checked').count())
        ) {
          const questionLine =
            labelText
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.length > 12 && l.includes("?")) ?? labelText;
          const resolved = matchAnswerToOption(answer, ["True", "False", "Yes", "No"]);
          if (
            (await fillRadioInQuestionBlock(page, questionLine, resolved)) &&
            !answered.includes(key)
          ) {
            answered.push(key);
          }
        }
      } catch {
        /* skip group */
      }
    }

    const labels = target.locator("label");
    const labelCount = Math.min(await labels.count(), 60);
    for (let i = 0; i < labelCount; i++) {
      try {
        const label = labels.nth(i);
        const text = ((await label.innerText()) ?? "").slice(0, 300);
        const key = matchScreeningKey(text);
        if (!key || answered.includes(key)) continue;
        const answer = resolveAnswer(key, screeningAnswers, coverLetter);
        if (!answer) continue;
        const forId = await label.getAttribute("for");
        if (!forId) continue;
        const input = target.locator(
          `[id="${forId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
        );
        if ((await input.count()) === 0) continue;
        const tag = await input.evaluate("el => el.tagName.toLowerCase()");
        const type = ((await input.getAttribute("type")) ?? "text").toLowerCase();
        if (tag === "textarea" || type === "text" || type === "number" || type === "") {
          const cur = await input.inputValue();
          if (!cur.trim()) {
            const val =
              type === "number"
                ? normalizeYearsExperienceAnswer(answer, text, "number")
                : answer;
            await input.fill(val);
            answered.push(key);
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  return [...new Set(answered)];
}

function toQuestionInput(field: DiscoveredFormField): ApplyQuestionInput {
  return {
    label: field.label,
    fieldType: field.fieldType,
    options: field.options.length ? field.options : undefined,
  };
}

/** Fast pass for "experience with X" numeric fields (LinkedIn decimal inputs). */
async function answerNumericExperienceFields(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];
  const discovered = await discoverUnfilledFormFields(page);

  for (const field of discovered) {
    if (
      field.fieldType === "radio" ||
      field.fieldType === "select" ||
      field.fieldType === "combobox"
    ) {
      continue;
    }
    if (!isYearsExperienceQuestion(field.label, field.fieldType)) continue;

    const q = toQuestionInput(field);
    let ans = heuristicApplyAnswer(q, ctx);
    if (!ans?.trim()) {
      ans = normalizeYearsExperienceAnswer(DEFAULT_YEARS_EXPERIENCE, field.label, field.fieldType);
    }
    ans = normalizeYearsExperienceAnswer(ans, field.label, field.fieldType);

    let ok = await fillDiscoveredField(page, field, ans);
    if (!ok) {
      ok = await fillNumericInputInQuestionBlock(page, field.label, ans);
    }
    if (ok) answered.push(field.label.slice(0, 80));
  }

  return answered;
}

/** Fast pass for yes/no radios and LinkedIn dropdowns before the AI batch. */
async function answerYesNoAndDropdowns(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];
  const discovered = await discoverUnfilledFormFields(page);
  for (const field of discovered) {
    if (
      field.fieldType !== "radio" &&
      field.fieldType !== "select" &&
      field.fieldType !== "combobox"
    ) {
      continue;
    }
    const q: ApplyQuestionInput = {
      label: field.label,
      fieldType: field.fieldType,
      options: field.options,
    };
    const ans = heuristicApplyAnswer(q, ctx);
    if (!ans) continue;
    const resolved = matchAnswerToOption(ans, field.options.length ? field.options : ["Yes", "No"]);
    const ok = await fillDiscoveredField(page, field, resolved);
    if (ok) answered.push(field.label.slice(0, 80));
  }
  return answered;
}

/** Fill any remaining questions using AI + resume context (LinkedIn Easy Apply, etc.). */
export async function answerDynamicQuestionsWithAi(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];
  const quick = await answerYesNoAndDropdowns(page, ctx);
  answered.push(...quick);
  const numeric = await answerNumericExperienceFields(page, ctx);
  answered.push(...numeric);
  const radios = await fillAllLinkedInRadiosForce(page, ctx);
  answered.push(...radios);
  const dropdowns = await fillAllEmptyLinkedInDropdowns(page, ctx);
  answered.push(...dropdowns);
  answered.push(...(await fillAllUncheckedRadioGroups(page, ctx)));

  const discovered = await discoverUnfilledFormFields(page);
  if (discovered.length === 0) return answered;

  const batch = discovered.slice(0, 12);
  const answers = await generateApplyQuestionAnswers(
    batch.map(toQuestionInput),
    ctx
  );

  for (const field of batch) {
    let answer = answers.get(field.label)?.trim();
    if (!answer) continue;
    answer = normalizeYearsExperienceAnswer(answer, field.label, field.fieldType);
    const ok = await fillDiscoveredField(page, field, answer);
    if (ok) answered.push(field.label.slice(0, 80));
  }

  return answered;
}

/** Fill screening questions: known patterns first, then AI for anything else. */
export async function answerScreeningQuestions(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  aiContext?: ApplyQuestionContext
): Promise<string[]> {
  const known = await fillKnownScreeningFields(
    page,
    screeningAnswers,
    coverLetter,
    aiContext
  );

  const onIndeedSmartApply = /smartapply\.indeed\.com/i.test(page.url());
  if (onIndeedSmartApply && aiContext) {
    const indeedFilled = await completeIndeedScreeningStep(
      page,
      screeningAnswers,
      coverLetter,
      aiContext,
      6
    );
    known.push(...indeedFilled);
  }

  if (!aiContext?.resumeText?.trim()) {
    const minimalCtx = {
      jobTitle: aiContext?.jobTitle ?? "",
      company: aiContext?.company ?? "",
      jobDescription: aiContext?.jobDescription ?? "",
      resumeText: "",
      coverLetter,
      profile: aiContext?.profile ?? ({} as ApplyQuestionContext["profile"]),
    };
    const radioPass = await fillAllLinkedInRadiosForce(page, minimalCtx);
    const radioPass2 = await fillAllUncheckedRadioGroups(page, minimalCtx);
    const dropdownPass = await fillAllEmptyLinkedInDropdowns(page, minimalCtx);
    const numericPass = await answerNumericExperienceFields(page, minimalCtx);
    const moreRadios = await answerYesNoAndDropdowns(page, minimalCtx);
    return [...new Set([...known, ...radioPass, ...radioPass2, ...dropdownPass, ...numericPass, ...moreRadios])];
  }

  const aiAnswered = await answerDynamicQuestionsWithAi(page, aiContext);
  return [...new Set([...known, ...aiAnswered])];
}

/** One fast pass over radios, dropdowns, and numeric fields on the current step. */
export async function ensureEasyApplyStepQuick(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<boolean> {
  if (
    !(await hasVisibleValidationErrors(page)) &&
    !(await hasUnfilledEasyApplyRequiredFields(page))
  ) {
    return true;
  }

  await fillAllLinkedInRadiosForce(page, ctx);
  await fillKnownLinkedInDropdowns(page);
  await fillAllEmptyLinkedInDropdowns(page, ctx);
  await answerNumericExperienceFields(page, ctx);

  return (
    !(await hasVisibleValidationErrors(page)) &&
    !(await hasUnfilledEasyApplyRequiredFields(page))
  );
}

/** Fill required fields; retry only while the step still has errors (max 5 passes). */
export async function ensureEasyApplyStepComplete(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<boolean> {
  if (await ensureEasyApplyStepQuick(page, ctx)) return true;

  for (let attempt = 0; attempt < 5; attempt++) {
    await fillAllLinkedInRadiosForce(page, ctx);
    await fillKnownLinkedInDropdowns(page);
    await fillAllEmptyLinkedInDropdowns(page, ctx);
    await fillAllUncheckedRadioGroups(page, ctx);
    await answerNumericExperienceFields(page, ctx);

    if (
      !(await hasVisibleValidationErrors(page)) &&
      !(await hasUnfilledEasyApplyRequiredFields(page))
    ) {
      return true;
    }
    await safeWait(page, 300);
  }
  return (
    !(await hasVisibleValidationErrors(page)) &&
    !(await hasUnfilledEasyApplyRequiredFields(page))
  );
}

/** Fill discovered radio groups using heuristics only (no LLM). */
async function fillDiscoveredRadiosHeuristic(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const filled: string[] = [];
  const discovered = await discoverUnfilledFormFields(page);
  for (const field of discovered) {
    if (field.fieldType !== "radio") continue;
    const options = field.options.length ? field.options : ["Yes", "No"];
    const ans = heuristicApplyAnswer(
      { label: field.label, fieldType: "radio", options },
      ctx
    );
    if (!ans?.trim()) continue;
    const resolved = matchAnswerToOption(ans, options);
    if (await fillDiscoveredField(page, field, resolved)) {
      filled.push(field.label.slice(0, 80));
    }
  }
  return filled;
}

/** Heuristic-only fill (no LLM) — use before Next/Review to avoid long AI loops. */
export async function forceCompleteCurrentEasyApplyStep(
  page: Page,
  ctx: ApplyQuestionContext,
  _screeningAnswers: Record<string, string>,
  _coverLetter: string,
  maxPasses = 3
): Promise<boolean> {
  for (let pass = 0; pass < maxPasses; pass++) {
    if (
      !(await hasVisibleValidationErrors(page)) &&
      !(await hasUnfilledEasyApplyRequiredFields(page))
    ) {
      return true;
    }

    await fillAllLinkedInRadiosForce(page, ctx);
    await fillKnownLinkedInDropdowns(page);
    await fillAllEmptyLinkedInDropdowns(page, ctx);
    await fillAllUncheckedRadioGroups(page, ctx);
    await answerNumericExperienceFields(page, ctx);
    await fillDiscoveredRadiosHeuristic(page, ctx);
    await safeWait(page, 200);
  }

  return (
    !(await hasVisibleValidationErrors(page)) &&
    !(await hasUnfilledEasyApplyRequiredFields(page))
  );
}

/** Re-run fill when LinkedIn shows validation errors before advancing. */
export async function resolveFormValidationWithAi(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  if (!(await hasVisibleValidationErrors(page))) return [];

  const fixed: string[] = [];
  const ok = await ensureEasyApplyStepComplete(page, ctx);
  if (ok) return ["step_complete"];

  fixed.push(...(await answerDynamicQuestionsWithAi(page, ctx)));
  await ensureEasyApplyStepComplete(page, ctx);
  return fixed;
}
