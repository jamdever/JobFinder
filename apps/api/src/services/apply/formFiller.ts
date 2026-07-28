import type { Page } from "playwright";
import type { UserProfile } from "@jobfinder/shared";
import { matchFieldKey, matchFieldKeyFromLabel } from "./fieldPatterns.js";
import type { ApplyQuestionContext } from "../ai/applyQuestions.js";
import { FORM_FIELD_META_SCRIPT } from "./pageEvaluate.js";
import { applicationTargets } from "./pageUtils.js";

export function profileValues(profile: UserProfile, coverLetter: string): Record<string, string> {
  const p = profile.personal;
  const parts = p.fullName.trim().split(/\s+/);
  return {
    fullName: p.fullName,
    firstName: parts[0] ?? p.fullName,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] ?? "",
    email: p.email,
    phone: p.phone ?? "",
    linkedin: p.linkedinUrl ?? "",
    portfolio: p.portfolioUrl ?? p.githubUrl ?? "",
    github: p.githubUrl ?? "",
    location: p.location ?? "",
    coverLetter,
  };
}

type FieldMeta = {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  aria: string;
};

async function readMeta(
  el: ReturnType<Page["locator"]>
): Promise<FieldMeta | null> {
  return el.evaluate(FORM_FIELD_META_SCRIPT) as Promise<FieldMeta | null>;
}

async function fillElement(
  el: ReturnType<Page["locator"]>,
  meta: FieldMeta,
  value: string
): Promise<boolean> {
  const inputType = (meta.type || "text").toLowerCase();
  if (["hidden", "submit", "button", "image"].includes(inputType)) return false;

  if (meta.tag === "select") {
    try {
      await el.selectOption({ label: value });
      return true;
    } catch {
      try {
        await el.selectOption(value);
        return true;
      } catch {
        return false;
      }
    }
  }

  if (inputType === "checkbox" || inputType === "radio") return false;

  try {
    await el.fill(value);
    return true;
  } catch {
    return false;
  }
}

/** Map employer question labels (email, phone, name, cover letter) to profile values. */
export function resolveProfileFieldAnswer(
  label: string,
  ctx: ApplyQuestionContext
): string | null {
  const key = matchFieldKeyFromLabel(label);
  if (!key) return null;
  const values = profileValues(ctx.profile, ctx.coverLetter);
  const value = values[key]?.trim();
  return value || null;
}

export async function fillKnownFields(
  page: Page,
  coverLetter: string,
  profile: UserProfile
): Promise<string[]> {
  const values = profileValues(profile, coverLetter);
  const filled = new Set<string>();

  for (const target of applicationTargets(page)) {
    const inputs = target.locator("input, textarea, select");
    const count = await inputs.count();

    for (let i = 0; i < Math.min(count, 100); i++) {
      const el = inputs.nth(i);
      try {
        if (!(await el.isVisible())) continue;
        const meta = await readMeta(el);
        if (!meta?.tag) continue;
        const key = matchFieldKey(meta);
        if (!key || !values[key]?.trim()) continue;
        const ok = await fillElement(el, meta, values[key]);
        if (ok) filled.add(key);
      } catch {
        /* skip field */
      }
    }
  }

  return [...filled];
}

export async function fillEmptyTextareas(page: Page, coverLetter: string): Promise<number> {
  let count = 0;
  for (const target of applicationTargets(page)) {
    const areas = target.locator("textarea");
    const n = await areas.count();
    for (let i = 0; i < Math.min(n, 15); i++) {
      const area = areas.nth(i);
      try {
        if (!(await area.isVisible())) continue;
        const current = await area.inputValue();
        if (current.trim()) continue;
        const placeholder = ((await area.getAttribute("placeholder")) ?? "").toLowerCase();
        const aria = ((await area.getAttribute("aria-label")) ?? "").toLowerCase();
        const blob = `${placeholder} ${aria}`;
        if (["cover", "message", "why", "tell us", "about you", "additional"].some((k) => blob.includes(k))) {
          await area.fill(coverLetter);
          count++;
        }
      } catch {
        /* skip */
      }
    }
  }
  return count;
}
