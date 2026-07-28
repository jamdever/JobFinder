import type { Page } from "playwright";
import { fillLinkedInDropdown } from "./discoverFormQuestions.js";
import { safeWait } from "./safePage.js";

/** Fast fill for common LinkedIn dropdown screening questions. */
export async function fillKnownLinkedInDropdowns(page: Page): Promise<string[]> {
  const filled: string[] = [];
  const modal = page.locator(".jobs-easy-apply-modal, [role='dialog']").first();

  const targets: { pattern: RegExp; answer: string }[] = [
    { pattern: /legally authorized.*work.*ireland|authorized to work in ireland/i, answer: "Yes" },
    { pattern: /located in ireland|currently in ireland|based in ireland/i, answer: "Yes" },
    { pattern: /require sponsorship|visa status/i, answer: "No" },
  ];

  for (const { pattern, answer } of targets) {
    const block = modal
      .locator(".jobs-easy-apply-form-element, .fb-dash-form-element")
      .filter({ hasText: pattern })
      .first();

    if ((await block.count()) === 0) continue;
    const text = (await block.innerText()) ?? "";
    if (!/select an option/i.test(text)) continue;

    const labelLine =
      text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.includes("?") && l.length > 10) ?? "";

    if (await fillLinkedInDropdown(page, labelLine || text.slice(0, 80), answer)) {
      filled.push(pattern.source);
      await safeWait(page, 200);
    }
  }

  return filled;
}
