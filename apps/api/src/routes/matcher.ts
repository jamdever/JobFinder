import { Router } from "express";
import { collectJobs } from "../services/matcher.js";
import {
  failCollectProgress,
  finishCollectProgress,
  getCollectProgress,
  setCollectProgress,
  startCollectProgress,
} from "../services/collectProgress.js";
import { listDashboardJobs } from "../services/jobList.js";

export const matcherRouter = Router();

matcherRouter.get("/collect/progress", (_req, res) => {
  res.json(getCollectProgress());
});

matcherRouter.post("/collect/sync", async (_req, res) => {
  try {
    startCollectProgress("Starting job search…");
    const result = await collectJobs();

    setCollectProgress({
      percent: 96,
      stage: "finishing",
      message: "Preparing your results…",
    });

    const jobs = await listDashboardJobs({
      ids: result.jobIds.length > 0 ? result.jobIds : undefined,
      limit: 100,
    });

    const removedNote =
      result.removed > 0 ? ` Removed ${result.removed} old jobs that didn't match.` : "";
    const dupNote =
      result.duplicatesRemoved > 0
        ? ` Merged ${result.duplicatesRemoved} duplicate listing(s).`
        : "";

    finishCollectProgress(
      result.found > 0 ? `Found ${result.found} role(s).` : "Search finished."
    );

    res.json({
      message: `Jobs collected.${removedNote}${dupNote}`,
      found: result.found,
      eligible: result.eligible,
      removed: result.removed,
      duplicatesRemoved: result.duplicatesRemoved,
      bySource: result.bySource,
      jobIds: result.jobIds,
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Collect failed";
    failCollectProgress(message);
    res.status(500).json({ error: message });
  }
});

matcherRouter.post("/browser-login", async (req, res) => {
  try {
    const { openBrowserForManualLogin } = await import("../services/apply/browserSession.js");
    const { getApplyBrowserLoginStatus } = await import("../services/apply/applyBrowserLogin.js");
    const platform = req.body?.platform;
    const valid =
      platform === "linkedin" || platform === "indeed" || platform === "both"
        ? platform
        : "both";
    const result = await openBrowserForManualLogin(valid);
    const login = await getApplyBrowserLoginStatus();
    res.json({ ...result, login });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open browser";
    res.status(500).json({ error: message });
  }
});
