import type { Page } from "playwright";

/** Use string scripts so tsx/esbuild does not inject `__name` into the browser context. */
export function evalOnPage<T>(page: Page, script: string): Promise<T> {
  const trimmed = script.trim();
  // A bare `() => { ... }` string is a function value, not its return value — invoke it.
  if (/^\(?\s*(async\s*)?(\(\)|\([^)]*\))\s*=>/.test(trimmed) || trimmed.startsWith("function")) {
    return page.evaluate(`(${trimmed})()`) as Promise<T>;
  }
  return page.evaluate(trimmed) as Promise<T>;
}

export const LINKEDIN_DETECT_APPLY_MODE_SCRIPT = `() => {
  const body = (document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
  const hasEasyApply = /\\beasy apply\\b/.test(body);
  const hasCompanyWebsite =
    /apply on company website/i.test(body) ||
    /you will be redirected/i.test(body) ||
    /on the company/i.test(body);

  let offsiteButton = false;
  let easyApplyButton = false;

  for (const el of document.querySelectorAll("button, a")) {
    const text = (el.textContent || "").trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (/easy apply/.test(text) || /easy apply/.test(aria)) easyApplyButton = true;
    if (/apply on company website/.test(text) || /apply on company website/.test(aria)) {
      offsiteButton = true;
    }
    const tracking = el.getAttribute("data-tracking-control-name") || "";
    if (/offsite|external/.test(tracking)) offsiteButton = true;
    if (el.classList && el.classList.contains("jobs-apply-button--off-site")) offsiteButton = true;
    if (el.classList && /easy-apply|jobs-apply-button--easy/i.test(el.className)) {
      easyApplyButton = true;
    }
  }

  const applySelectors = [
    ".jobs-apply-button--top-card",
    ".jobs-s-apply",
    ".jobs-apply-button--easy-apply",
    "[data-control-name='jobdetails_topcard_inapply']",
    "button[aria-label*='Easy Apply']",
    "a[aria-label*='Easy Apply']",
  ];
  for (const sel of applySelectors) {
    const applyBtn = document.querySelector(sel);
    if (!applyBtn) continue;
    const label = ((applyBtn.textContent || "") + " " + (applyBtn.getAttribute("aria-label") || "")).toLowerCase();
    if (/easy apply/.test(label)) easyApplyButton = true;
    if (applyBtn.classList.contains("jobs-apply-button--off-site")) offsiteButton = true;
  }

  return { hasEasyApply, hasCompanyWebsite, offsiteButton, easyApplyButton };
}`;

export const LINKEDIN_EXTRACT_COMPANY_URLS_SCRIPT = `() => {
  const found = [];
  const push = (href) => {
    if (href && found.indexOf(href) === -1) found.push(href);
  };

  for (const a of document.querySelectorAll("a[href]")) {
    const text = (a.textContent || "").toLowerCase();
    const tracking = a.getAttribute("data-tracking-control-name") || "";
    const href = a.href || null;
    if (
      /apply on company website|company website|offsite|external apply/i.test(text) ||
      /offsite|external/.test(tracking)
    ) {
      push(href);
    }
  }

  const applyBtn = document.querySelector(
    ".jobs-apply-button--top-card, a[data-control-name='jobdetails_topcard_inapply']"
  );
  if (applyBtn && applyBtn.href) push(applyBtn.href);

  return found;
}`;

export const FORM_FIELD_META_SCRIPT = `(node) => {
  const tag = node.tagName ? node.tagName.toLowerCase() : "";
  let label = "";
  if (node.labels && node.labels[0]) {
    label = node.labels[0].innerText || "";
  }
  if (!label && node.id) {
    const forLabel = document.querySelector('label[for="' + node.id + '"]');
    if (forLabel) label = forLabel.textContent || "";
  }
  if (!label || label.length < 3) {
    let parent = node.parentElement;
    for (let depth = 0; depth < 8 && parent; depth++) {
      const lbl = parent.querySelector("label");
      if (lbl && lbl !== node && !lbl.contains(node)) {
        const t = (lbl.textContent || "").trim();
        if (t.length > 2 && t.length < 250) {
          label = t;
          break;
        }
      }
      const lines = (parent.textContent || "")
        .split("\\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 2 && s.length < 250);
      const prompt = lines.find((s) => !/^(yes|no|true|false|select)$/i.test(s));
      if (prompt && prompt.length < 200) {
        label = prompt;
        break;
      }
      parent = parent.parentElement;
    }
  }
  return {
    tag: tag,
    type: node.getAttribute("type") || "",
    name: node.getAttribute("name") || "",
    id: node.id || "",
    placeholder: node.getAttribute("placeholder") || "",
    label: label,
    aria: node.getAttribute("aria-label") || "",
  };
}`;

export const INPUT_TAG_SCRIPT = "el => el.tagName.toLowerCase()";

export const LINKEDIN_ALREADY_APPLIED_SCRIPT = `() => {
  const body = (document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
  if (
    /you applied on|your application was sent|application submitted|already applied/i.test(body)
  ) {
    return true;
  }
  for (const el of document.querySelectorAll("button, a")) {
    const text = (el.textContent || "").trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (text === "applied" || aria === "applied") return true;
    if (/you.?ve applied|application sent/i.test(aria)) return true;
  }
  const topCard = document.querySelector(".jobs-apply-button--top-card, .jobs-s-apply");
  if (topCard) {
    const label = (topCard.textContent || "").trim().toLowerCase();
    if (label === "applied" || /applied/i.test(label) && !/easy apply/i.test(label)) return true;
  }
  return false;
}`;
