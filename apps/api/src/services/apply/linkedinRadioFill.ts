import type { Page } from "playwright";
import { heuristicApplyAnswer, matchAnswerToOption } from "../ai/applyQuestions.js";
import type { ApplyQuestionContext } from "../ai/applyQuestions.js";
import { safeWait } from "./safePage.js";

type RadioGroupInfo = {
  label: string;
  options: string[];
  name: string;
};

function modalLocator(page: Page) {
  return page.locator(".jobs-easy-apply-modal, [role='dialog']").first();
}

/** List unchecked radio groups by shared input[name] (HTML radio groups). */
async function listUncheckedRadioGroups(page: Page): Promise<RadioGroupInfo[]> {
  return page.evaluate(() => {
    const modal =
      document.querySelector(".jobs-easy-apply-modal") ||
      document.querySelector("[role='dialog']");
    if (!modal) return [];

    const out: RadioGroupInfo[] = [];
    const byName = new Map<string, HTMLInputElement[]>();

    modal.querySelectorAll('input[type="radio"]').forEach((inp) => {
      const input = inp as HTMLInputElement;
      const name = input.name || input.id || `radio-${out.length}`;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(input);
    });

    byName.forEach((inputs, name) => {
      if (inputs.length < 2) return;
      if (inputs.some((i) => i.checked)) return;

      let block: Element | null = inputs[0].closest(
        ".jobs-easy-apply-form-element, .fb-dash-form-element, fieldset, [role='radiogroup'], li"
      );
      if (!block) block = inputs[0].parentElement;

      let label = "";
      if (block) {
        const labelEl = block.querySelector(
          ".jobs-easy-apply-form-element__label, [data-test-form-builder-label], .fb-dash-form-element__label, legend"
        );
        label = (labelEl?.textContent || "").trim();
        if (!label || label.length < 8) {
          const lines = (block.textContent || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          label =
            lines.find((l) => l.includes("?") && l.length > 8) ||
            lines.find((l) => l.length > 12 && !/^(yes|no)$/i.test(l)) ||
            "";
        }
      }

      const options: string[] = [];
      inputs.forEach((inp) => {
        let t = "";
        const id = inp.id;
        if (id) {
          const lbl = modal.querySelector(`label[for="${CSS.escape(id)}"]`);
          t = (lbl?.textContent || "").trim();
        }
        if (!t) {
          const wrap = inp.closest("label");
          if (wrap) t = (wrap.textContent || "").trim();
        }
        if (!t && inp.nextElementSibling) {
          t = (inp.nextElementSibling.textContent || "").trim();
        }
        if (t && t.length < 50) options.push(t);
      });

      if (label) out.push({ label, options, name });
    });

    return out;
  });
}

/** Click via Playwright (handles React-controlled radios). */
async function clickRadioPlaywright(
  page: Page,
  group: RadioGroupInfo,
  answer: string
): Promise<boolean> {
  const modal = modalLocator(page);
  const want = answer.trim();
  const snippet = group.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 48);

  const block = modal
    .locator(
      ".jobs-easy-apply-form-element, .fb-dash-form-element, fieldset, [role='radiogroup'], li"
    )
    .filter({ hasText: new RegExp(snippet, "i") })
    .last();

  if ((await block.count()) === 0) return false;

  const strategies: Array<() => Promise<unknown>> = [
    () => block.getByRole("radio", { name: new RegExp(`^${want}$`, "i") }).first().click({ force: true, timeout: 8000 }),
    () => block.locator("label").filter({ hasText: new RegExp(`^${want}$`, "i") }).first().click({ force: true, timeout: 8000 }),
    () => block.getByText(new RegExp(`^${want}$`, "i")).first().click({ force: true, timeout: 8000 }),
    async () => {
      const clicked = (await block.locator('input[type="radio"]').evaluateAll(
        (inputs, { wantAnswer }) => {
          for (const input of inputs) {
            const el = input as HTMLInputElement;
            let t = "";
            const id = el.id;
            const root = el.closest(".jobs-easy-apply-modal, [role='dialog']") || document;
            if (id) {
              const lbl = root.querySelector(`label[for="${CSS.escape(id)}"]`);
              t = (lbl?.textContent || "").trim().toLowerCase();
            }
            if (!t) {
              const wrap = el.closest("label");
              if (wrap) t = (wrap.textContent || "").trim().toLowerCase();
            }
            const w = wantAnswer.toLowerCase();
            if (
              t === w ||
              (w === "no" && t.startsWith("no")) ||
              (w === "yes" && t.startsWith("yes"))
            ) {
              el.click();
              el.checked = true;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              const lbl = id ? root.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
              if (lbl) (lbl as HTMLElement).click();
              return el.checked;
            }
          }
          return false;
        },
        { wantAnswer: want }
      )) as boolean[];
      if (!clicked.some(Boolean)) throw new Error("dom click failed");
    },
  ];

  for (const run of strategies) {
    try {
      await run();
      await safeWait(page, 350);
      const checked =
        (await block.locator('input[type="radio"]:checked').count()) > 0 ||
        (await block.locator('[role="radio"][aria-checked="true"]').count()) > 0;
      if (checked) return true;
    } catch {
      /* next strategy */
    }
  }

  return (await block.locator('input[type="radio"]:checked').count()) > 0;
}

/** Fill radios on blocks that show "Please make a selection". */
async function fillRadiosFromValidationErrors(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const filled: string[] = [];
  const modal = modalLocator(page);
  const errors = modal.locator(
    ".artdeco-inline-feedback--error, [class*='error-message'], [data-test-error]"
  );
  const n = Math.min(await errors.count(), 15);

  for (let i = 0; i < n; i++) {
    const err = errors.nth(i);
    const errText = ((await err.innerText()) ?? "").toLowerCase();
    if (!/make a selection|valid answer|required|please select/i.test(errText)) continue;

    const block = modal
      .locator(".jobs-easy-apply-form-element, .fb-dash-form-element, fieldset, li")
      .filter({ has: err })
      .first();
    if ((await block.count()) === 0) continue;

    const labelText = ((await block.innerText()) ?? "").slice(0, 600);
    const labelLine =
      labelText
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.includes("?") && l.length > 10) ?? labelText.slice(0, 120);

    const ans = heuristicApplyAnswer(
      { label: labelLine, fieldType: "radio", options: ["Yes", "No"] },
      ctx
    );
    if (!ans) continue;

    const resolved = matchAnswerToOption(ans, ["Yes", "No"]);
    const group: RadioGroupInfo = { label: labelLine, options: ["Yes", "No"], name: "" };

    if (await clickRadioPlaywright(page, group, resolved)) {
      filled.push(`error-fix:${labelLine.slice(0, 60)}`);
    }
  }

  return filled;
}

/** Targeted fill for common LinkedIn screening questions by label text. */
async function fillKnownRadioPatterns(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const filled: string[] = [];
  const modal = modalLocator(page);

  const targets: { pattern: RegExp; answer: string }[] = [
    { pattern: /require sponsorship|visa status|employment visa/i, answer: "No" },
    { pattern: /legally authorized.*work.*ireland|authorized to work in ireland/i, answer: "Yes" },
    { pattern: /legally authorized|eligible to work|right to work/i, answer: "Yes" },
    { pattern: /completed the following level of education|bachelor's degree/i, answer: "Yes" },
    { pattern: /able to come into the office|days per week|work (on.?site|in the office)/i, answer: "Yes" },
    { pattern: /located in ireland|currently in ireland|based in ireland/i, answer: "Yes" },
    { pattern: /commute|relocate|willing to/i, answer: "Yes" },
    { pattern: /english proficiency|fluent in english/i, answer: "Yes" },
    {
      pattern: /living in ireland|valid working permit|still wish to continue|still wish to c/i,
      answer: "Yes",
    },
    { pattern: /comfortable commuting|commuting to this job/i, answer: "Yes" },
  ];

  for (const { pattern, answer } of targets) {
    const blocks = modal
      .locator(".jobs-easy-apply-form-element, .fb-dash-form-element, fieldset, li")
      .filter({ hasText: pattern });
    const count = Math.min(await blocks.count(), 3);

    for (let b = 0; b < count; b++) {
      const block = blocks.nth(b);
      const checkedNative = await block.locator('input[type="radio"]:checked').count();
      const checkedArtdeco = await block.locator('[role="radio"][aria-checked="true"]').count();
      if (checkedNative > 0 || checkedArtdeco > 0) continue;

      const labelLine =
        ((await block.innerText()) ?? "")
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.includes("?") && l.length > 10) ?? "";

      await block.getByText(new RegExp(`^${answer}$`, "i")).first().click({ force: true, timeout: 8000 }).catch(() => undefined);
      await safeWait(page, 200);
      const hasSelection =
        (await block.locator('input[type="radio"]:checked').count()) > 0 ||
        (await block.locator('[role="radio"][aria-checked="true"]').count()) > 0;
      if (hasSelection) {
        filled.push(labelLine.slice(0, 60) || pattern.source);
        continue;
      }

      const group: RadioGroupInfo = { label: labelLine, options: ["Yes", "No"], name: "" };
      if (await clickRadioPlaywright(page, group, answer)) {
        filled.push(labelLine.slice(0, 60) || pattern.source);
      }
    }
  }

  return filled;
}

/**
 * Force-fill every unchecked Yes/No radio in the Easy Apply modal.
 */
export async function fillAllLinkedInRadiosForce(
  page: Page,
  ctx: ApplyQuestionContext
): Promise<string[]> {
  const filled: string[] = [];

  filled.push(...(await fillKnownRadioPatterns(page, ctx)));
  filled.push(...(await fillRadiosFromValidationErrors(page, ctx)));

  const groups = await listUncheckedRadioGroups(page);

  for (const group of groups) {
    const ans = heuristicApplyAnswer(
      {
        label: group.label,
        fieldType: "radio",
        options: group.options.length ? group.options : ["Yes", "No"],
      },
      ctx
    );
    if (!ans?.trim()) continue;

    const resolved = matchAnswerToOption(
      ans,
      group.options.length ? group.options : ["Yes", "No"]
    );

    if (await clickRadioPlaywright(page, group, resolved)) {
      filled.push(group.label.slice(0, 80));
    }
  }

  if (await hasUncheckedRadios(page)) {
    filled.push(...(await fillKnownRadioPatterns(page, ctx)));
    filled.push(...(await fillRadiosFromValidationErrors(page, ctx)));
  }

  return [...new Set(filled)];
}

async function hasUncheckedRadios(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const modal =
      document.querySelector(".jobs-easy-apply-modal") ||
      document.querySelector("[role='dialog']");
    if (!modal) return false;

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
}
