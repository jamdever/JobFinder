import type { Frame, Page } from "playwright";
import {
  heuristicApplyAnswer,
  isYearsExperienceQuestion,
  isYesNoQuestion,
  matchAnswerToOption,
  pickDropdownOptionForAnswer,
  type ApplyFieldType,
  type ApplyQuestionContext,
} from "../ai/applyQuestions.js";
import { fillAllLinkedInRadiosForce } from "./linkedinRadioFill.js";
import { safeWait } from "./safePage.js";
import { applicationTargets } from "./pageUtils.js";

export interface DiscoveredFormField {
  label: string;
  fieldType: ApplyFieldType;
  options: string[];
  id: string;
  name: string;
  tag: string;
  inputType: string;
}

type RawDiscovered = {
  label: string;
  tag: string;
  type: string;
  options: string[];
  id: string;
  name: string;
  groupId?: string;
};

export const DISCOVER_UNFILLED_FIELDS_SCRIPT = `() => {
  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };

  const modal =
    document.querySelector(".jobs-easy-apply-modal") ||
    document.querySelector('[data-test-modal-id]') ||
    document.querySelector('[role="dialog"]');
  const root = modal || document.body;

  function labelForControl(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim().length > 2) return aria.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    const id = el.id;
    if (id) {
      const lbl = root.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    let node = el.parentElement;
    for (let depth = 0; depth < 10 && node && node !== root; depth++) {
      const legend = node.querySelector("legend");
      if (legend && legend.textContent && legend.textContent.trim().length > 8) {
        return legend.textContent.trim();
      }
      const labels = node.querySelectorAll("label, span[data-test-form-builder-label], .fb-dash-form-element__label");
      for (const l of labels) {
        const t = (l.textContent || "").trim();
        if (t.length > 8 && !/^\\d+$/.test(t)) return t;
      }
      const prev = el.previousElementSibling;
      if (prev && prev.textContent && prev.textContent.trim().length > 10) {
        return prev.textContent.trim();
      }
      node = node.parentElement;
    }
    return "";
  }

  const out = [];
  const seen = new Set();

  root.querySelectorAll("input, textarea, select").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "file", "submit", "button", "image", "reset"].includes(type)) return;
    if (!isVisible(el)) return;
    if (el.disabled || el.readOnly) return;
    const label = labelForControl(el);
    if (tag === "select") {
      const opt = el.options[el.selectedIndex];
      const optText = (opt?.textContent || "").trim();
      if (optText && !/^(select an option|choose|please select|--)$/i.test(optText)) return;
    } else {
      const value = (el.value || "").trim();
      if (value && !/select an option/i.test(value)) return;
    }

    if (!label || label.length < 4) return;
    const key = label.slice(0, 150);
    if (seen.has(key)) return;
    seen.add(key);

    let options = [];
    if (tag === "select") {
      options = Array.from(el.options)
        .map((o) => (o.textContent || "").trim())
        .filter((t) => t && t.length < 120);
    }

    out.push({
      label,
      tag,
      type,
      options,
      id: el.id || "",
      name: el.name || "",
    });
  });

  function labelFromBlock(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 12 && node && node !== root; depth++) {
      const labelEl = node.querySelector(
        "label, legend, span[data-test-form-builder-label], .fb-dash-form-element__label, .jobs-easy-apply-form-element__label"
      );
      if (labelEl) {
        const t = (labelEl.textContent || "").trim();
        if (t.length > 10) return t;
      }
      const heading = node.querySelector("span, p, div");
      if (heading) {
        const t = (heading.textContent || "").trim();
        if (t.length > 15 && t.includes("?")) return t;
      }
      node = node.parentElement;
    }
    return labelForControl(el);
  }

  root.querySelectorAll(
    '[role="combobox"], button[aria-haspopup="listbox"], .artdeco-dropdown__trigger, select'
  ).forEach((el) => {
    if (!isVisible(el)) return;
    const tag = el.tagName.toLowerCase();
    let isEmpty = false;
    let options = [];

    if (tag === "select") {
      const opt = el.options[el.selectedIndex];
      const optText = (opt?.textContent || "").trim();
      isEmpty = !optText || /select an option|choose|please select/i.test(optText);
      options = Array.from(el.options)
        .map((o) => (o.textContent || "").trim())
        .filter((t) => t && !/^select an option$/i.test(t) && t.length < 120);
    } else {
      const txt = (el.textContent || el.getAttribute("aria-label") || "").trim();
      isEmpty = /select an option|choose an option|please select/i.test(txt) || txt.length < 2;
    }
    if (!isEmpty) return;

    const label = labelFromBlock(el);
    if (!label || label.length < 4) return;
    if (seen.has(label)) return;
    seen.add(label);

    out.push({
      label,
      tag: tag === "select" ? "select" : "combobox",
      type: tag === "select" ? "select" : "combobox",
      options,
      id: el.id || "",
      name: el.name || "",
    });
  });

  function questionLabelForRadioGroup(group) {
    const labelSelectors = [
      ".jobs-easy-apply-form-element__label",
      "span[data-test-form-builder-label]",
      ".fb-dash-form-element__label",
      "legend",
    ];
    for (const sel of labelSelectors) {
      const el = group.querySelector(sel);
      const t = (el?.textContent || "").trim();
      if (t.length > 12) return t;
    }
    const lines = (group.innerText || "")
      .split("\\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
    const withQ = lines.find((l) => l.includes("?"));
    if (withQ) return withQ;
    const longLine = lines.find((l) => l.length > 20 && !/^(yes|no)$/i.test(l));
    return longLine || lines[0] || "";
  }

  function radioOptionLabels(group) {
    const options = [];
    group.querySelectorAll('input[type="radio"]').forEach((r) => {
      let text = "";
      const id = r.id;
      if (id) {
        const lbl = root.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
        text = (lbl?.textContent || "").trim();
      }
      if (!text) {
        const sib = r.nextElementSibling;
        if (sib && /^(label|span)$/i.test(sib.tagName)) {
          text = (sib.textContent || "").trim();
        }
      }
      if (!text && r.parentElement) {
        const lbl = r.parentElement.querySelector("label");
        if (lbl && lbl !== r) text = (lbl.textContent || "").trim();
      }
      if (text && text.length < 40 && !text.includes("?")) options.push(text);
    });
    return options;
  }

  root
    .querySelectorAll(
      '[role="radiogroup"], fieldset, .jobs-easy-apply-form-element, .fb-dash-form-element, .jobs-easy-apply-form-section__group'
    )
    .forEach((group) => {
      if (!isVisible(group)) return;
      const radios = group.querySelectorAll('input[type="radio"]');
      if (radios.length < 2) return;
      const checked = group.querySelector('input[type="radio"]:checked');
      if (checked) return;
      const label = questionLabelForRadioGroup(group);
      if (!label || label.length < 4) return;
      if (seen.has(label)) return;
      seen.add(label);
      let options = radioOptionLabels(group);
      if (!options.length) options = ["True", "False", "Yes", "No"];
      out.push({
        label,
        tag: "fieldset",
        type: "radio",
        options,
        id: "",
        name: "",
        groupId: group.id || label.slice(0, 40),
      });
    });

  return out;
}`;

function toFieldType(raw: RawDiscovered): ApplyFieldType {
  if (raw.type === "radio" || raw.tag === "fieldset") return "radio";
  if (raw.type === "combobox" || raw.tag === "combobox") return "combobox";
  if (raw.type === "number") return "number";
  if (raw.tag === "textarea") return "textarea";
  if (raw.tag === "select") return "select";
  if (raw.type === "checkbox") return "checkbox";
  if (isYearsExperienceQuestion(raw.label, "text")) return "number";
  return "text";
}

function defaultOptionsForField(label: string, fieldType: ApplyFieldType): string[] {
  if (fieldType === "radio" || fieldType === "select" || fieldType === "combobox") {
    if (isYesNoQuestion(label)) return ["True", "False", "Yes", "No"];
  }
  return [];
}

async function evalOnTarget<T>(target: Page | Frame, script: string): Promise<T> {
  const trimmed = script.trim();
  if (/^\(?\s*(async\s*)?(\(\)|\([^)]*\))\s*=>/.test(trimmed) || trimmed.startsWith("function")) {
    return target.evaluate(`(${trimmed})()`) as Promise<T>;
  }
  return target.evaluate(trimmed) as Promise<T>;
}

export async function discoverUnfilledFormFields(page: Page): Promise<DiscoveredFormField[]> {
  const merged: DiscoveredFormField[] = [];
  const seen = new Set<string>();

  for (const target of applicationTargets(page)) {
    const raw = await evalOnTarget<RawDiscovered[]>(target, DISCOVER_UNFILLED_FIELDS_SCRIPT);
    for (const r of raw) {
      const label = r.label.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const fieldType = toFieldType(r);
      const options =
        r.options?.length ? r.options : defaultOptionsForField(label, fieldType);
      merged.push({
        label,
        fieldType,
        options,
        id: r.id ?? "",
        name: r.name ?? "",
        tag: r.tag,
        inputType: r.type,
      });
    }
  }

  return merged;
}

function cssEscape(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function fillInput(target: Page | Frame, field: DiscoveredFormField, answer: string): Promise<boolean> {
  try {
    if (field.id) {
      const el = target.locator(`#${cssEscape(field.id)}`);
      if ((await el.count()) > 0) {
        await el.fill(answer);
        await el.blur().catch(() => undefined);
        return true;
      }
    }
    if (field.name) {
      const el = target.locator(
        `${field.tag === "textarea" ? "textarea" : "input"}[name="${field.name.replace(/"/g, '\\"')}"]`
      );
      if ((await el.count()) > 0) {
        await el.first().fill(answer);
        await el.first().blur().catch(() => undefined);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Fill a numeric experience input inside the LinkedIn question block (text or number input). */
export async function fillNumericInputInQuestionBlock(
  page: Page,
  questionLabel: string,
  answer: string
): Promise<boolean> {
  try {
    const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
    const root = (await modal.count()) > 0 ? modal : page;
    const snippet = questionSnippet(questionLabel);
    if (snippet.length < 6) return false;

    const block = root
      .locator(
        ".jobs-easy-apply-form-element, .fb-dash-form-element, .jobs-easy-apply-form-section__group, li"
      )
      .filter({ hasText: new RegExp(snippet, "i") })
      .first();

    if ((await block.count()) === 0) return false;

    const inputs = block.locator(
      'input[type="text"], input[type="number"], input[inputmode="decimal"], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'
    );
    const n = Math.min(await inputs.count(), 4);

    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      try {
        if (!(await input.isVisible())) continue;
        const cur = (await input.inputValue()).trim();
        if (cur && parseFloat(cur) > 0) return true;
        await input.click({ timeout: 3000 });
        await input.fill("");
        await input.fill(answer);
        await input.blur().catch(() => undefined);
        const after = (await input.inputValue()).trim();
        if (after && parseFloat(after) > 0) return true;
      } catch {
        /* try next input in block */
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Whether a question block has a selected radio (native or Artdeco). */
export async function isEasyApplyRadioGroupFilled(
  block: import("playwright").Locator
): Promise<boolean> {
  if ((await block.locator('input[type="radio"]:checked').count()) > 0) return true;
  if ((await block.locator('[role="radio"][aria-checked="true"]').count()) > 0) return true;
  return false;
}

function questionSnippet(label: string): string {
  const core = label
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = core.split(" ").filter(Boolean);
  const take = words.slice(0, Math.min(8, words.length)).join(" ");
  return take.slice(0, 55).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Click Yes/No (or similar) inside the block that contains the question text. */
export async function fillRadioInQuestionBlock(
  page: Page,
  questionLabel: string,
  answer: string
): Promise<boolean> {
  try {
    const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
    const root = (await modal.count()) > 0 ? modal : page;
    const snippet = questionSnippet(questionLabel);
    if (snippet.length < 6) return false;

    const block = root
      .locator(
        ".jobs-easy-apply-form-element, .fb-dash-form-element, fieldset, [role='radiogroup'], [data-testid*='question'], [class*='Question'], section, li, div"
      )
      .filter({ hasText: new RegExp(snippet, "i") })
      .filter({ has: root.locator('input[type="radio"]') })
      .last();

    if ((await block.count()) === 0) return false;

    if (await isEasyApplyRadioGroupFilled(block)) return true;

    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exact = new RegExp(`^\\s*${escaped}\\s*$`, "i");
    const loose = new RegExp(`\\b${escaped}\\b`, "i");

    const radio = block.getByRole("radio", { name: exact });
    if ((await radio.count()) > 0) {
      await radio.first().click({ force: true, timeout: 8000 });
      if (await isEasyApplyRadioGroupFilled(block)) return true;
    }

    const radioLoose = block.getByRole("radio", { name: loose });
    if ((await radioLoose.count()) > 0) {
      await radioLoose.first().click({ force: true, timeout: 8000 });
      if (await isEasyApplyRadioGroupFilled(block)) return true;
    }

    const optionLabel = block.locator("label").filter({ hasText: exact });
    if ((await optionLabel.count()) > 0) {
      await optionLabel.first().click({ force: true, timeout: 8000 });
      if (await isEasyApplyRadioGroupFilled(block)) return true;
    }

    const optionLabelLoose = block.locator("label, span").filter({ hasText: loose });
    if ((await optionLabelLoose.count()) > 0) {
      await optionLabelLoose.first().click({ force: true, timeout: 8000 });
      if (await isEasyApplyRadioGroupFilled(block)) return true;
    }

    const inputs = block.locator('input[type="radio"]');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute("id");
      let labelText = "";
      if (id) {
        const lbl = block.locator(`label[for="${cssEscape(id)}"]`);
        if ((await lbl.count()) > 0) {
          labelText = ((await lbl.first().innerText()) ?? "").trim();
        }
      }
      if (!labelText) {
        labelText = await input.evaluate((el) => {
          const sib = el.nextElementSibling;
          if (sib && /^(label|span)$/i.test(sib.tagName)) {
            return (sib.textContent ?? "").trim();
          }
          return "";
        });
      }
      if (exact.test(labelText)) {
        await input.check({ force: true });
        if (await isEasyApplyRadioGroupFilled(block)) return true;
      }
    }

    return await isEasyApplyRadioGroupFilled(block);
  } catch {
    return false;
  }
}

async function fillRadioByLabel(page: Page, field: DiscoveredFormField, answer: string): Promise<boolean> {
  if (await fillRadioInQuestionBlock(page, field.label, answer)) return true;
  try {
    const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
    const root = (await modal.count()) > 0 ? modal : page;
    const pattern = new RegExp(`^${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const radio = root.getByRole("radio", { name: pattern });
    if ((await radio.count()) > 0) {
      await radio.last().click({ timeout: 5000 });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function fillSelect(target: Page | Frame, field: DiscoveredFormField, answer: string): Promise<boolean> {
  try {
    const sel = field.id
      ? target.locator(`select#${cssEscape(field.id)}`)
      : field.name
        ? target.locator(`select[name="${field.name.replace(/"/g, '\\"')}"]`)
        : null;
    if (!sel || (await sel.count()) === 0) return false;
    await sel.first().selectOption({ label: answer }).catch(async () => {
      await sel.first().selectOption({ value: answer });
    });
    return true;
  } catch {
    return false;
  }
}

async function clickListboxOption(page: Page, answer: string): Promise<boolean> {
  const options = page.locator(
    '[role="listbox"] [role="option"], .artdeco-dropdown__item, [data-test-text-selectable-option], li[role="option"]'
  );
  const oCount = Math.min(await options.count(), 50);
  if (oCount === 0) return false;

  const texts: string[] = [];
  for (let j = 0; j < oCount; j++) {
    const text = ((await options.nth(j).innerText()) ?? "").trim();
    if (text) texts.push(text);
  }
  const resolved = pickDropdownOptionForAnswer(answer, texts);
  const answerLower = resolved.toLowerCase();

  for (let j = 0; j < oCount; j++) {
    const opt = options.nth(j);
    const text = ((await opt.innerText()) ?? "").trim();
    if (!text || /^select an option$/i.test(text)) continue;
    const tl = text.toLowerCase();
    if (
      tl === answerLower ||
      tl.startsWith(`${answerLower},`) ||
      tl.startsWith(`${answerLower} `) ||
      tl.includes(answerLower) ||
      answerLower.includes(tl)
    ) {
      await opt.click({ timeout: 5000 });
      return true;
    }
  }
  return false;
}

/** LinkedIn Easy Apply custom dropdowns (combobox / "Select an option" buttons). */
export async function fillLinkedInDropdown(
  page: Page,
  questionLabel: string,
  answer: string
): Promise<boolean> {
  const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
  const root = (await modal.count()) > 0 ? modal : page;
  const snippet = questionSnippet(questionLabel);
  if (snippet.length < 6) return false;

  const block = root
    .locator(
      ".jobs-easy-apply-form-section__group, .fb-dash-form-element, fieldset, li, .jobs-easy-apply-form-element"
    )
    .filter({ hasText: new RegExp(snippet, "i") })
    .first();

  if ((await block.count()) === 0) return false;

  const blockText = ((await block.innerText()) ?? "").toLowerCase();
  if (!/select an option/i.test(blockText) && /yes|no|\d+\s*days/i.test(blockText)) {
    return true;
  }

  const triggers = block.locator(
    'select, [role="combobox"], button, .artdeco-dropdown__trigger, [data-test-text-select-trigger], [aria-haspopup="listbox"]'
  );
  const tCount = Math.min(await triggers.count(), 12);

  for (let i = 0; i < tCount; i++) {
    const trigger = triggers.nth(i);
    try {
      if (!(await trigger.isVisible())) continue;
      const triggerText = ((await trigger.innerText()) ?? "").toLowerCase();
      const tag = await trigger.evaluate((el) => el.tagName.toLowerCase());

      if (tag === "select") {
        const opts = await trigger.locator("option").allInnerTexts();
        const resolved = pickDropdownOptionForAnswer(answer, opts);
        await trigger.selectOption({ label: resolved }).catch(async () => {
          await trigger.selectOption({ label: answer });
        });
        return true;
      }

      if (
        tag !== "button" &&
        tag !== "div" &&
        tag !== "span" &&
        !triggerText.includes("select an option") &&
        !/combobox|listbox/i.test((await trigger.getAttribute("role")) ?? "")
      ) {
        continue;
      }

      await trigger.click({ timeout: 8000 });
      await safeWait(page, 600);

      if (await clickListboxOption(page, answer)) {
        await safeWait(page, 300);
        return true;
      }

      await page.keyboard.press("Escape").catch(() => undefined);
    } catch {
      /* try next trigger */
    }
  }

  try {
    const selectText = block.getByText(/select an option/i).first();
    if ((await selectText.count()) > 0) {
      await selectText.click({ timeout: 5000 });
      await safeWait(page, 600);
      if (await clickListboxOption(page, answer)) return true;
    }
  } catch {
    /* fall through */
  }

  return false;
}

/** Fill every LinkedIn dropdown in the modal that still shows "Select an option". */
export async function fillAllEmptyLinkedInDropdowns(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const filled: string[] = [];
  const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
  const root = (await modal.count()) > 0 ? modal : page;
  const blocks = root.locator(".jobs-easy-apply-form-element, .fb-dash-form-element");
  const n = Math.min(await blocks.count(), 40);

  for (let i = 0; i < n; i++) {
    const block = blocks.nth(i);
    try {
      const text = (await block.innerText()) ?? "";
      if (!/select an option/i.test(text)) continue;

      const labelLine =
        text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.includes("?") && l.length > 12) ??
        text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 12) ??
        "";

      if (!labelLine) continue;

      const ans = heuristicApplyAnswer(
        { label: labelLine, fieldType: "combobox", options: ["Yes", "No"] },
        ctx
      );
      if (!ans) continue;

      if (await fillLinkedInDropdown(page, labelLine, ans)) {
        filled.push(labelLine.slice(0, 80));
      }
    } catch {
      /* next block */
    }
  }

  return filled;
}

/** Fill each Easy Apply question block that still has an unchecked Yes/No radio group. */
export async function fillAllUncheckedRadioGroups(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const filled: string[] = await fillAllLinkedInRadiosForce(page, ctx);
  const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
  const root = (await modal.count()) > 0 ? modal : page;
  const elements = root.locator(".jobs-easy-apply-form-element, .fb-dash-form-element");
  const n = Math.min(await elements.count(), 40);

  for (let i = 0; i < n; i++) {
    const el = elements.nth(i);
    try {
      const radioCount = await el.locator('input[type="radio"], [role="radio"]').count();
      if (radioCount < 2) continue;
      if (await isEasyApplyRadioGroupFilled(el)) continue;

      const text = (await el.innerText()) ?? "";
      const labelLine =
        text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.includes("?") && l.length > 10) ??
        text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 15) ??
        "";

      if (!labelLine) continue;

      const ans = heuristicApplyAnswer(
        { label: labelLine, fieldType: "radio", options: ["Yes", "No"] },
        ctx
      );
      if (!ans?.trim()) continue;

      const resolved = matchAnswerToOption(ans, ["Yes", "No"]);
      if (await fillRadioInQuestionBlock(page, labelLine, resolved)) {
        filled.push(labelLine.slice(0, 80));
      }
    } catch {
      /* next */
    }
  }

  return filled;
}

export async function fillDiscoveredField(
  page: Page,
  field: DiscoveredFormField,
  answer: string
): Promise<boolean> {
  const options = field.options.length ? field.options : ["True", "False", "Yes", "No"];
  const resolved =
    field.fieldType === "radio" ||
    field.fieldType === "select" ||
    field.fieldType === "combobox"
      ? matchAnswerToOption(answer, options)
      : answer;

  if (field.fieldType === "radio") {
    if (await fillRadioByLabel(page, field, resolved)) return true;
    if (await fillLinkedInDropdown(page, field.label, resolved)) return true;
    return false;
  }

  if (field.fieldType === "select" || field.fieldType === "combobox") {
    if (await fillLinkedInDropdown(page, field.label, resolved)) return true;
    for (const target of applicationTargets(page)) {
      if (await fillSelect(target, field, resolved)) return true;
    }
    return false;
  }

  if (field.fieldType === "number" || isYearsExperienceQuestion(field.label, field.fieldType)) {
    if (await fillNumericInputInQuestionBlock(page, field.label, resolved)) return true;
  }

  for (const target of applicationTargets(page)) {
    if (await fillInput(target, field, resolved)) return true;
  }

  if (field.fieldType === "number" || isYearsExperienceQuestion(field.label, field.fieldType)) {
    return fillNumericInputInQuestionBlock(page, field.label, resolved);
  }
  return false;
}

/** True when the modal still has empty required radios or dropdowns. */
export async function hasUnfilledEasyApplyRequiredFields(page: Page): Promise<boolean> {
  try {
    const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
    const text =
      (await modal.count()) > 0
        ? ((await modal.innerText().catch(() => "")) ?? "").toLowerCase()
        : ((await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")) ?? "").toLowerCase();
    if (/select an option/i.test(text)) return true;
    if (/please make a selection/i.test(text)) return true;

    return page.evaluate(() => {
      const modal =
        document.querySelector(".jobs-easy-apply-modal") ||
        document.querySelector("[role='dialog']");
      if (!modal) return false;

      const groups = modal.querySelectorAll('[role="radiogroup"]');
      for (const rg of groups) {
        const radios = rg.querySelectorAll('[role="radio"]');
        if (radios.length >= 2) {
          const selected = [...radios].some(
            (r) => r.getAttribute("aria-checked") === "true"
          );
          if (!selected) return true;
        }
      }

      const byName = new Map<string, HTMLInputElement[]>();
      modal.querySelectorAll('input[type="radio"]').forEach((inp) => {
        const input = inp as HTMLInputElement;
        const name = input.name || input.id;
        if (!name) return;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push(input);
      });
      for (const inputs of byName.values()) {
        if (inputs.length >= 2 && !inputs.some((i) => i.checked)) return true;
      }
      return false;
    });
  } catch {
    return true;
  }
}

export async function hasVisibleValidationErrors(page: Page): Promise<boolean> {
  try {
    const bodyText = ((await page.locator("body").innerText()) ?? "").slice(0, 8000);
    if (/choose an option to continue/i.test(bodyText)) return true;

    const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
    const root = (await modal.count()) > 0 ? modal : page;
    const errorText = root.locator(
      '[class*="error"], [aria-invalid="true"], .artdeco-inline-feedback--error, [data-test-error], [role="alert"]'
    );
    if ((await errorText.count()) === 0) return false;
    const sample = await errorText.first().innerText().catch(() => "");
    return /required|enter a|invalid|whole number|decimal number|larger than 0|select an option|choose an option|valid answer|please (enter|select|make a selection)/i.test(
      sample
    );
  } catch {
    return false;
  }
}
