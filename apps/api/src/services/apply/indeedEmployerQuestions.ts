import type { Page } from "playwright";
import {
  generateApplyQuestionAnswers,
  heuristicApplyAnswer,
  inferApplyFieldType,
  isYesNoQuestion,
  type ApplyQuestionContext,
  type ApplyQuestionInput,
} from "../ai/applyQuestions.js";
import {
  discoverUnfilledFormFields,
  fillDiscoveredField,
} from "./discoverFormQuestions.js";
import { matchFieldKeyFromLabel, matchScreeningKey } from "./fieldPatterns.js";
import {
  fillEmptyTextareas,
  fillKnownFields,
  profileValues,
  resolveProfileFieldAnswer,
} from "./formFiller.js";
import { FORM_FIELD_META_SCRIPT } from "./pageEvaluate.js";
import { resolveAnswer } from "./questionFiller.js";

function isMistakenYesAnswer(label: string, value: string): boolean {
  if (!/^yes$/i.test(value.trim())) return false;
  return Boolean(matchFieldKeyFromLabel(label)) || /email|phone|name|cover letter/i.test(label);
}

function resolveEmployerTextAnswer(
  label: string,
  fieldType: ApplyQuestionInput["fieldType"],
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext
): string {
  const profile = resolveProfileFieldAnswer(label, ctx);
  if (profile) return profile;

  const screeningKey = matchScreeningKey(label);
  if (screeningKey) {
    const fromScreening = resolveAnswer(screeningKey, screeningAnswers, coverLetter);
    if (fromScreening?.trim() && !isMistakenYesAnswer(label, fromScreening)) {
      return fromScreening;
    }
  }

  const inferred = inferApplyFieldType(label, fieldType);
  const ans = heuristicApplyAnswer(
    { label, fieldType: inferred, options: undefined },
    ctx
  );
  if (ans?.trim() && !isMistakenYesAnswer(label, ans)) return ans;
  return "";
}

/** Replace mistaken "Yes" in contact/cover fields with profile values. */
async function fixMistakenYesFills(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const fixed: string[] = [];
  const inputs = page.locator('input[type="text"], input:not([type]), textarea');
  const count = Math.min(await inputs.count(), 40);

  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    try {
      if (!(await el.isVisible())) continue;
      const value = ((await el.inputValue()) ?? "").trim();
      if (!/^yes$/i.test(value)) continue;

      const meta = await el.evaluate(FORM_FIELD_META_SCRIPT);
      if (!meta) continue;
      const label = [meta.label, meta.aria, meta.placeholder].filter(Boolean).join(" ");
      if (!isMistakenYesAnswer(label, value)) continue;

      const correct = resolveProfileFieldAnswer(label, ctx);
      if (!correct) continue;

      await el.fill(correct);
      await el.blur().catch(() => undefined);
      fixed.push(label.slice(0, 50));
    } catch {
      /* next */
    }
  }
  return fixed;
}

/**
 * Indeed "Answer these questions from the employer" — profile fields first, then AI for the rest.
 */
export async function fillIndeedEmployerQuestions(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];

  answered.push(...(await fillKnownFields(page, coverLetter, ctx.profile)));
  const textareaCount = await fillEmptyTextareas(page, coverLetter);
  if (textareaCount > 0) answered.push("coverLetter");

  answered.push(...(await fixMistakenYesFills(page, ctx)));

  let discovered = await discoverUnfilledFormFields(page);
  const textFields = discovered.filter(
    (f) =>
      f.fieldType !== "radio" &&
      f.fieldType !== "select" &&
      f.fieldType !== "combobox" &&
      !(f.fieldType === "text" && isYesNoQuestion(f.label, f.options))
  );

  for (const field of textFields) {
    const ans = resolveEmployerTextAnswer(
      field.label,
      field.fieldType,
      screeningAnswers,
      coverLetter,
      ctx
    );
    if (!ans?.trim()) continue;
    if (await fillDiscoveredField(page, field, ans)) {
      answered.push(field.label.slice(0, 60));
    }
  }

  discovered = await discoverUnfilledFormFields(page);
  const needsAi = discovered.filter(
    (f) =>
      f.fieldType !== "radio" &&
      f.fieldType !== "select" &&
      f.fieldType !== "combobox"
  );

  if (needsAi.length > 0 && ctx.resumeText.trim().length > 40) {
    const batch = needsAi.slice(0, 10).map((f) => ({
      label: f.label,
      fieldType: inferApplyFieldType(f.label, f.fieldType),
      options: f.options.length ? f.options : undefined,
    }));

    const aiAnswers = await generateApplyQuestionAnswers(batch, ctx);
    for (const field of needsAi.slice(0, 10)) {
      let answer =
        aiAnswers.get(field.label)?.trim() ||
        [...aiAnswers.entries()].find(
          ([k]) => field.label.includes(k.slice(0, 30)) || k.includes(field.label.slice(0, 30))
        )?.[1]?.trim();

      if (!answer) {
        answer = resolveEmployerTextAnswer(
          field.label,
          field.fieldType,
          screeningAnswers,
          coverLetter,
          ctx
        );
      }
      if (!answer || isMistakenYesAnswer(field.label, answer)) continue;
      if (await fillDiscoveredField(page, field, answer)) {
        answered.push(field.label.slice(0, 60));
      }
    }
  }

  answered.push(...(await fixMistakenYesFills(page, ctx)));

  return [...new Set(answered)];
}

/** Quick check that contact fields use profile data, not "Yes". */
export function expectedProfileSnapshot(ctx: ApplyQuestionContext): Record<string, string> {
  return profileValues(ctx.profile, ctx.coverLetter);
}
