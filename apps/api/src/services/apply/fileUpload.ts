import fs from "node:fs/promises";
import type { Frame, Page } from "playwright";
import { applicationTargets } from "./pageUtils.js";
import { safeWait } from "./safePage.js";

export async function uploadCvPdf(page: Page, pdfPath: string): Promise<boolean> {
  try {
    await fs.access(pdfPath);
  } catch {
    return false;
  }

  for (const target of applicationTargets(page)) {
    const fileInputs = target.locator('input[type="file"]');
    const count = await fileInputs.count();
    for (let i = 0; i < count; i++) {
      const input = fileInputs.nth(i);
      try {
        if (!(await input.isVisible())) continue;
        const accept = ((await input.getAttribute("accept")) ?? "").toLowerCase();
        if (accept && !accept.includes("pdf") && !accept.includes("*")) continue;
        await input.setInputFiles(pdfPath);
        await safeWait(page, 800);
        return true;
      } catch {
        /* try next input */
      }
    }
  }
  return false;
}
