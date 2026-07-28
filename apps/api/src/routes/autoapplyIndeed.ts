import { Router } from "express";
import { JobModel } from "../models/Job.js";
import { collectIndeedEasyApplyJobs } from "../services/matcher.js";
import { listIndeedEasyApplyCandidates } from "../services/autoApply/indeed/eligibleJobs.js";
import {
  listIndeedAutoApplyLogs,
  runIndeedEasyApplyPipeline,
} from "../services/autoApply/indeed/pipeline.js";
import { processIndeedEasyApplyQueue } from "../services/autoApply/indeed/applyQueue.js";
import {
  getApplyBrowserLoginStatus,
  isIndeedJobUrl,
} from "../services/apply/applyBrowserLogin.js";
import { getJobApplyCompletionState } from "../services/autoApply/jobCompletion.js";
import { clearIndeedAutoApplyData } from "../services/autoApply/indeed/clear.js";
import {
  getIndeedAutoApplyWatchStatus,
  setIndeedAutoApplyWatch,
} from "../services/autoApply/indeed/watch.js";

export const autoApplyIndeedRouter = Router();

autoApplyIndeedRouter.get("/unlock-indeed/status", async (_req, res) => {
  try {
    const { getIndeedUnlockStatus } = await import("../services/apply/indeedWarmup.js");
    res.json(await getIndeedUnlockStatus());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read unlock status";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.post("/unlock-indeed", async (_req, res) => {
  try {
    const { unlockIndeedBrowserAccess } = await import(
      "../services/apply/indeedWarmup.js"
    );
    const result = await unlockIndeedBrowserAccess();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not unlock Indeed";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.get("/watch", async (_req, res) => {
  res.json(await getIndeedAutoApplyWatchStatus());
});

autoApplyIndeedRouter.patch("/watch", async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    const applyEnabled = req.body?.applyEnabled;
    const dryRun = req.body?.dryRun;
    const maxPerScan =
      req.body?.maxPerScan != null ? Number(req.body.maxPerScan) : undefined;
    const intervalMinutes =
      req.body?.intervalMinutes != null ? Number(req.body.intervalMinutes) : undefined;
    const status = await setIndeedAutoApplyWatch({
      enabled: enabled === true ? true : enabled === false ? false : undefined,
      applyEnabled:
        applyEnabled === true ? true : applyEnabled === false ? false : undefined,
      dryRun: dryRun === true ? true : dryRun === false ? false : undefined,
      maxPerScan,
      intervalMinutes,
    });
    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update watch";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.post("/apply-queue", async (_req, res) => {
  try {
    const result = await processIndeedEasyApplyQueue();
    const status = await getIndeedAutoApplyWatchStatus();
    res.json({ ...result, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply queue failed";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.post("/clear", async (_req, res) => {
  try {
    const { logsRemoved, jobsRemoved } = await clearIndeedAutoApplyData();
    const status = await getIndeedAutoApplyWatchStatus();
    res.json({
      message: `Cleared ${jobsRemoved} Indeed Easy Apply jobs and ${logsRemoved} log entries`,
      logsRemoved,
      jobsRemoved,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not clear Auto Apply Indeed data";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.post("/scan", async (_req, res) => {
  try {
    const result = await collectIndeedEasyApplyJobs();
    let message = `Found ${result.found} Indeed jobs (${result.easyApplyInDb} Easy Apply in database)`;
    if (result.found === 0 && result.indeedOnBoard > 0) {
      message += `. ${result.indeedOnBoard} on Indeed boards but none matched your title/location filters — check Job Search settings.`;
    } else if (result.found === 0 && result.indeedWarning) {
      message += `. ${result.indeedWarning}`;
    } else if (result.found === 0 && result.untaggedIndeedInDb > 0) {
      message += `. ${result.untaggedIndeedInDb} Indeed job(s) from dashboard search are not tagged Easy Apply — scan again after this fix or use Find jobs with Indeed enabled.`;
    }
    res.json({
      message,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indeed Easy Apply scan failed";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.post("/open-job/:jobId", async (req, res) => {
  try {
    const doc = await JobModel.findById(req.params.jobId);
    if (!doc) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const { openUrlInAutomationBrowser } = await import("../services/apply/browserSession.js");
    const result = await openUrlInAutomationBrowser(doc.url);
    const login = await getApplyBrowserLoginStatus();
    const loginNote =
      !login.indeed.ready
        ? " Sign in on Indeed in that window if prompted."
        : "";
    res.json({
      ...result,
      jobId: String(doc._id),
      url: doc.url,
      message: result.message + loginNote,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open job in browser";
    res.status(500).json({ error: message });
  }
});

autoApplyIndeedRouter.get("/job-status/:jobId", async (req, res) => {
  const state = await getJobApplyCompletionState(req.params.jobId);
  res.json(state);
});

autoApplyIndeedRouter.get("/candidates", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 30), 50);
  const minAiScore = req.query.minAiScore != null ? Number(req.query.minAiScore) : undefined;
  const candidates = await listIndeedEasyApplyCandidates({ limit, minAiScore });
  res.json(candidates);
});

autoApplyIndeedRouter.get("/logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  res.json(await listIndeedAutoApplyLogs(limit));
});

autoApplyIndeedRouter.post("/run/:jobId", async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const headless = req.body?.headless === true;
    const skipAnalyze = req.body?.skipAnalyze === true;
    const skipTailor = req.body?.skipTailor === true;
    const forceRetry = req.body?.forceRetry === true;

    const result = await runIndeedEasyApplyPipeline({
      jobId: req.params.jobId,
      dryRun,
      headless,
      skipAnalyze,
      skipTailor,
      forceRetry,
    });

    const message =
      result.status === "skipped" && result.message.startsWith("Already complete")
        ? result.message
        : result.submitted
          ? "Indeed Easy Apply submitted"
          : dryRun
            ? result.message
            : "Pipeline finished";

    res.json({ message, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto Apply Indeed failed";
    const status = /sign-in required|cloudflare/i.test(message) ? 401 : 500;
    res.status(status).json({ error: message });
  }
});
