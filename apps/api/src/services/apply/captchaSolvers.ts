import type { Page } from "playwright";
import { env } from "../../config.js";

async function extractTurnstileSiteKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const withKey = document.querySelector("[data-sitekey]");
    if (withKey) return withKey.getAttribute("data-sitekey");
    const html = document.documentElement.innerHTML;
    const m = html.match(/data-sitekey=["']([^"']+)["']/i);
    if (m?.[1]) return m[1];
    const m2 = html.match(/sitekey['":\s]+([0-9xA-Za-z_-]{10,})/i);
    return m2?.[1] ?? null;
  });
}

export async function injectTurnstileToken(page: Page, token: string): Promise<void> {
  await page.evaluate((t) => {
    for (const el of document.querySelectorAll<HTMLInputElement>(
      '[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
    )) {
      el.value = t;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const form = document.querySelector<HTMLFormElement>(
      '#challenge-form, form[action*="challenge"], form[id*="challenge"]'
    );
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }, token);
}

async function pollCapsolver(taskId: string, apiKey: string, deadline: number): Promise<string | null> {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultJson = (await resultRes.json()) as {
      status?: string;
      solution?: { token?: string };
      errorDescription?: string;
    };
    if (resultJson.status === "ready" && resultJson.solution?.token) {
      return resultJson.solution.token;
    }
    if (resultJson.status === "failed") {
      console.warn("[captcha] CapSolver:", resultJson.errorDescription);
      return null;
    }
  }
  return null;
}

async function solveViaCapsolver(websiteURL: string, websiteKey: string): Promise<string | null> {
  const apiKey = env.capsolverApiKey.trim();
  if (!apiKey) return null;

  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL,
        websiteKey,
      },
    }),
  });
  const createJson = (await createRes.json()) as {
    errorId?: number;
    taskId?: string;
    errorDescription?: string;
  };
  if (createJson.errorId !== 0 || !createJson.taskId) {
    console.warn("[captcha] CapSolver create:", createJson.errorDescription);
    return null;
  }
  return pollCapsolver(createJson.taskId, apiKey, Date.now() + 120_000);
}

async function poll2Captcha(taskId: number, apiKey: string, deadline: number): Promise<string | null> {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://api.2captcha.com/getTaskResult?key=${encodeURIComponent(apiKey)}&taskId=${taskId}`
    );
    const json = (await res.json()) as {
      status?: string;
      solution?: { token?: string };
      errorDescription?: string;
    };
    if (json.status === "ready" && json.solution?.token) return json.solution.token;
    if (json.status === "failed") {
      console.warn("[captcha] 2Captcha:", json.errorDescription);
      return null;
    }
  }
  return null;
}

async function solveVia2Captcha(websiteURL: string, websiteKey: string): Promise<string | null> {
  const apiKey = env.twoCaptchaApiKey.trim();
  if (!apiKey) return null;

  const createRes = await fetch("https://api.2captcha.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "TurnstileTaskProxyless",
        websiteURL,
        websiteKey,
      },
    }),
  });
  const createJson = (await createRes.json()) as {
    errorId?: number;
    taskId?: number;
    errorDescription?: string;
  };
  if (createJson.errorId !== 0 || createJson.taskId == null) {
    console.warn("[captcha] 2Captcha create:", createJson.errorDescription);
    return null;
  }
  return poll2Captcha(createJson.taskId, apiKey, Date.now() + 120_000);
}

/** Solve Turnstile via CapSolver or 2Captcha (whichever is configured). */
export async function solveTurnstileWithApi(page: Page, targetUrl: string): Promise<boolean> {
  const websiteKey = await extractTurnstileSiteKey(page);
  if (!websiteKey) {
    console.warn("[captcha] No Turnstile sitekey on page");
    return false;
  }

  const websiteURL = targetUrl || page.url();
  console.log("[captcha] Solving Turnstile via API…");

  const token =
    (await solveViaCapsolver(websiteURL, websiteKey)) ??
    (await solveVia2Captcha(websiteURL, websiteKey));

  if (!token) return false;

  await injectTurnstileToken(page, token);
  await page.waitForTimeout(4000);
  return true;
}

export function hasCaptchaSolverConfigured(): boolean {
  return Boolean(env.capsolverApiKey.trim() || env.twoCaptchaApiKey.trim());
}
