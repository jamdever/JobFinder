import type { Page } from "playwright";
import {
  generateApplyQuestionAnswers,
  heuristicApplyAnswer,
  inferApplyFieldType,
  matchAnswerToOption,
  normalizeYearsExperienceAnswer,
  isYearsExperienceQuestion,
  isYesNoQuestion,
  type ApplyQuestionContext,
  type ApplyQuestionInput,
} from "../ai/applyQuestions.js";
import { matchFieldKeyFromLabel } from "./fieldPatterns.js";
import { profileValues, resolveProfileFieldAnswer } from "./formFiller.js";
import {
  discoverUnfilledFormFields,
  fillDiscoveredField,
  fillNumericInputInQuestionBlock,
  fillRadioInQuestionBlock,
  hasVisibleValidationErrors,
} from "./discoverFormQuestions.js";
import { matchScreeningKey } from "./fieldPatterns.js";
import { resolveAnswer } from "./questionFiller.js";

type IndeedRadioGroup = {
  name: string;
  question: string;
  options: string[];
};

function defaultOptionsForIndeed(): string[] {
  return ["True", "False", "Yes", "No"];
}

function resolveIndeedAnswer(
  label: string,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext
): string {
  const profile = resolveProfileFieldAnswer(label, ctx);
  if (profile) return profile;

  const key = matchScreeningKey(label);
  if (key) {
    const fromKey = resolveAnswer(key, screeningAnswers, coverLetter);
    if (fromKey?.trim()) {
      if (isYesNoQuestion(label) || !/^(yes|no)$/i.test(fromKey)) return fromKey;
    }
  }

  const fieldType = inferApplyFieldType(label);
  const q: ApplyQuestionInput = {
    label,
    fieldType,
    options:
      fieldType === "radio" ? defaultOptionsForIndeed() : undefined,
  };
  const ans = heuristicApplyAnswer(q, ctx) ?? "";
  if (/^(yes|no)$/i.test(ans) && fieldType === "text" && matchFieldKeyFromLabel(label)) {
    const values = profileValues(ctx.profile, coverLetter);
    const pk = matchFieldKeyFromLabel(label);
    if (pk && values[pk]?.trim()) return values[pk];
  }
  return ans;
}

const COLLECT_INDEED_RADIO_GROUPS_SCRIPT = `() => {
  const out = [];
  const seen = new Set();
  const byName = {};

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };

  const optionLabel = (r) => {
    if (r.id) {
      const lbl = document.querySelector("label[for='" + CSS.escape(r.id) + "']");
      const t = (lbl && lbl.textContent || "").trim();
      if (t && t.length < 40) return t;
    }
    const wrap = r.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll("input").forEach((i) => i.remove());
      const t = (clone.textContent || "").trim();
      if (t && t.length < 40) return t;
    }
    const sib = r.nextElementSibling;
    if (sib && /^(label|span)$/i.test(sib.tagName)) {
      const t = (sib.textContent || "").trim();
      if (t && t.length < 40) return t;
    }
    return (r.value || "").trim();
  };

  const questionFor = (radio) => {
    let node = radio.parentElement;
    for (let d = 0; d < 14 && node; d++) {
      const text = (node.textContent || "").replace(/\\s+/g, " ").trim();
      const q = text.match(/[^.?!]{12,400}\\?/);
      if (q) return q[0].trim();
      node = node.parentElement;
    }
    return "";
  };

  const addGroup = (key, radios) => {
    if (radios.length < 2) return;
    if (radios.some((r) => r.checked)) return;
    const options = radios.map(optionLabel).filter(Boolean);
    if (options.length < 2) return;
    const question = questionFor(radios[0]) || key;
    const dedupe = key + "|" + question;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ name: key, question, options: [...new Set(options)] });
  };

  document.querySelectorAll('input[type="radio"]').forEach((el) => {
    if (!isVisible(el) || el.disabled) return;
    const name = (el.name || "").trim();
    if (name) {
      if (!byName[name]) byName[name] = [];
      byName[name].push(el);
    }
  });

  for (const name of Object.keys(byName)) {
    addGroup(name, byName[name]);
  }

  document
    .querySelectorAll('[role="radiogroup"], fieldset, [data-testid*="question"], [class*="Question"]')
    .forEach((container, idx) => {
      const radios = Array.from(container.querySelectorAll('input[type="radio"]')).filter(
        (r) => isVisible(r) && !r.disabled
      );
      if (radios.length < 2) return;
      const key =
        container.id ||
        container.getAttribute("data-testid") ||
        container.getAttribute("aria-labelledby") ||
        "group-" + idx;
      addGroup(String(key), radios);
    });

  return out;
}`;

/** Group unchecked Indeed radios by name and collect question + option labels. */
async function collectIndeedUncheckedRadioGroups(page: Page): Promise<IndeedRadioGroup[]> {
  const raw = await page.evaluate(`(${COLLECT_INDEED_RADIO_GROUPS_SCRIPT})()`);
  return Array.isArray(raw) ? raw : [];
}

/** Click a radio option by group name (Indeed groups radios with the same name). */
async function clickIndeedRadioByName(
  page: Page,
  groupName: string,
  optionLabel: string
): Promise<boolean> {
  const pattern = new RegExp(`^\\s*${optionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");

  if (!groupName.startsWith("group-")) {
    const escapedName = groupName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const radios = page.locator(`input[type="radio"][name="${escapedName}"]`);
    const count = await radios.count();
    for (let i = 0; i < count; i++) {
      const radio = radios.nth(i);
      const id = await radio.getAttribute("id");
      if (id) {
        const lbl = page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`);
        if ((await lbl.count()) > 0) {
          const text = ((await lbl.first().innerText()) ?? "").trim();
          if (pattern.test(text)) {
            await radio.check({ force: true });
            return true;
          }
        }
      }
    }
  }

  const container = groupName.startsWith("group-")
    ? page.locator('[role="radiogroup"], fieldset, [data-testid*="question"], [class*="Question"]').nth(
        Number.parseInt(groupName.replace("group-", ""), 10)
      )
    : page
        .locator(
          `[id="${groupName.replace(/"/g, '\\"')}"], [data-testid="${groupName.replace(/"/g, '\\"')}"]`
        )
        .first();

  if ((await container.count()) > 0) {
    const byRole = container.getByRole("radio", { name: pattern });
    if ((await byRole.count()) > 0) {
      await byRole.first().check({ force: true });
      return true;
    }
    const label = container.locator("label").filter({ hasText: pattern });
    if ((await label.count()) > 0) {
      await label.first().click({ force: true });
      return true;
    }
  }

  const scoped = page
    .locator('[role="radiogroup"], fieldset')
    .filter({ has: page.locator('input[type="radio"]:not(:checked)') })
    .filter({ hasText: new RegExp(pattern.source.replace(/^\^|\$$/g, ""), "i") });
  if ((await scoped.count()) > 0) {
    const radio = scoped.first().getByRole("radio", { name: pattern });
    if ((await radio.count()) > 0) {
      await radio.first().check({ force: true });
      return true;
    }
  }

  const byPageRole = page.getByRole("radio", { name: pattern });
  if ((await byPageRole.count()) > 0) {
    await byPageRole.first().check({ force: true });
    return true;
  }
  return false;
}

/** Direct DOM fill for Indeed True/False (and Yes/No) radio groups. */
export async function fillIndeedRadiosViaDom(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];
  const groups = await collectIndeedUncheckedRadioGroups(page);

  for (const group of groups) {
    let ans = resolveIndeedAnswer(group.question, screeningAnswers, coverLetter, ctx);
    if (!ans?.trim()) continue;

    const resolved = matchAnswerToOption(ans, group.options);
    let ok = await fillRadioInQuestionBlock(page, group.question, resolved);
    if (!ok) {
      ok = await clickIndeedRadioByName(page, group.name, resolved);
    }
    if (ok) {
      answered.push(matchScreeningKey(group.question) ?? group.question.slice(0, 60));
    }
  }

  return [...new Set(answered)];
}

/** Fill numeric/text Indeed screening fields on the current step. */
async function fillIndeedTextFields(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];
  const discovered = await discoverUnfilledFormFields(page);

  for (const field of discovered) {
    if (field.fieldType === "radio") continue;

    const key = matchScreeningKey(field.label);
    const fieldType = inferApplyFieldType(field.label, field.fieldType);
    let ans = resolveIndeedAnswer(field.label, screeningAnswers, coverLetter, ctx);
    if (!ans?.trim()) {
      ans = heuristicApplyAnswer(
        { label: field.label, fieldType, options: field.options },
        ctx
      );
    }
    if (!ans?.trim() || (/^yes$/i.test(ans) && fieldType === "text")) continue;

    if (isYearsExperienceQuestion(field.label, field.fieldType)) {
      ans = normalizeYearsExperienceAnswer(ans, field.label, field.fieldType);
      if (await fillNumericInputInQuestionBlock(page, field.label, ans)) {
        answered.push(key ?? field.label.slice(0, 60));
        continue;
      }
    }

    if (await fillDiscoveredField(page, field, ans)) {
      answered.push(key ?? field.label.slice(0, 60));
    }
  }

  return answered;
}

/** Collect Indeed Smart Apply question lines that still need a True/False (or Yes/No) answer. */
async function listIndeedUnansweredQuestions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const seen = new Set<string>();

    const blocks = document.querySelectorAll(
      "fieldset, [role='radiogroup'], form div, section div, li"
    );

    for (const block of blocks) {
      const radios = block.querySelectorAll('input[type="radio"]');
      if (radios.length < 2) continue;
      if (block.querySelector('input[type="radio"]:checked')) continue;

      const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text.includes("?") || text.length < 15) continue;

      const line =
        text
          .split("?")
          .map((p) => p.trim())
          .find((p) => p.length > 20) ?? text;
      const question = `${line}?`.slice(0, 400);
      if (seen.has(question)) continue;
      seen.add(question);
      out.push(question);
    }

    return out;
  });
}

/**
 * Fill Indeed Smart Apply True/False screening questions using profile + heuristics + AI context.
 */
export async function fillIndeedScreeningQuestions(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const answered: string[] = [];

  answered.push(...(await fillIndeedRadiosViaDom(page, screeningAnswers, coverLetter, ctx)));
  answered.push(...(await fillIndeedTextFields(page, screeningAnswers, coverLetter, ctx)));

  const discovered = await discoverUnfilledFormFields(page);
  for (const field of discovered) {
    if (field.fieldType !== "radio") continue;
    const options =
      field.options.length >= 2 ? field.options : defaultOptionsForIndeed();
    const q: ApplyQuestionInput = {
      label: field.label,
      fieldType: "radio",
      options,
    };
    let ans = resolveIndeedAnswer(field.label, screeningAnswers, coverLetter, ctx);
    if (!ans?.trim()) continue;
    const resolved = matchAnswerToOption(ans, options);
    if (await fillDiscoveredField(page, field, resolved)) {
      answered.push(matchScreeningKey(field.label) ?? field.label.slice(0, 60));
    }
  }

  const questions = await listIndeedUnansweredQuestions(page);
  for (const questionLine of questions) {
    const options = defaultOptionsForIndeed();
    let ans = resolveIndeedAnswer(questionLine, screeningAnswers, coverLetter, ctx);
    if (!ans?.trim()) continue;

    const resolved = matchAnswerToOption(ans, options);
    if (await fillRadioInQuestionBlock(page, questionLine, resolved)) {
      answered.push(matchScreeningKey(questionLine) ?? questionLine.slice(0, 60));
    }
  }

  // AI fallback for anything still unanswered
  const stillOpen = await discoverUnfilledFormFields(page);
  const radioBatch = stillOpen.filter((f) => f.fieldType === "radio").slice(0, 8);
  if (radioBatch.length > 0) {
    const aiAnswers = await generateApplyQuestionAnswers(
      radioBatch.map((f) => ({
        label: f.label,
        fieldType: "radio" as const,
        options: f.options.length ? f.options : defaultOptionsForIndeed(),
      })),
      ctx
    );
    for (const field of radioBatch) {
      let ans = aiAnswers.get(field.label)?.trim();
      if (!ans) continue;
      const options = field.options.length ? field.options : defaultOptionsForIndeed();
      const resolved = matchAnswerToOption(ans, options);
      if (await fillDiscoveredField(page, field, resolved)) {
        answered.push(field.label.slice(0, 60));
      }
    }
    answered.push(...(await fillIndeedRadiosViaDom(page, screeningAnswers, coverLetter, ctx)));
  }

  return [...new Set(answered)];
}

/** Keep filling until validation errors are cleared. */
export async function completeIndeedScreeningStep(
  page: Page,
  screeningAnswers: Record<string, string>,
  coverLetter: string,
  ctx: ApplyQuestionContext,
  maxPasses = 10
): Promise<string[]> {
  const all: string[] = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const filled = await fillIndeedScreeningQuestions(
      page,
      screeningAnswers,
      coverLetter,
      ctx
    );
    all.push(...filled);
    if (!(await hasVisibleValidationErrors(page))) break;
    if (filled.length === 0) break;
  }
  return [...new Set(all)];
}
