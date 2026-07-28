import type { Frame, Page } from "playwright";
import { getActiveApplyTiming } from "./applyTiming.js";
import { safeWait } from "./safePage.js";

/** Pages + embedded ATS iframes to scan for form fields. */
export function applicationTargets(page: Page): (Page | Frame)[] {
  const targets: (Page | Frame)[] = [page];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const url = frame.url();
    if (
      /greenhouse|lever|workday|ashby|smartrecruiters|bamboohr|jobvite|icims|taleo|apply/i.test(
        url
      ) ||
      url.includes("iframe")
    ) {
      targets.push(frame);
    }
  }
  return targets;
}

export async function dismissCookieBanners(page: Page): Promise<void> {
  const patterns = [
    /accept all/i,
    /accept cookies/i,
    /allow all/i,
    /agree/i,
    /got it/i,
    /i understand/i,
    /reject all/i,
  ];
  for (const pattern of patterns) {
    try {
      const btn = page.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 2000 });
        await safeWait(page, 400);
        return;
      }
    } catch {
      /* next */
    }
  }
}

export async function waitForFormStability(page: Page, ms?: number): Promise<void> {
  await safeWait(page, ms ?? getActiveApplyTiming().formStabilityMs);
}
