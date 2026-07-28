import { Router } from "express";
import { JobModel } from "../models/Job.js";
import { collectLinkedInEasyApplyJobs } from "../services/matcher.js";
import { listEasyApplyCandidates } from "../services/autoApply/eligibleJobs.js";
import { listAutoApplyLogs, runLinkedInEasyApplyPipeline } from "../services/autoApply/pipeline.js";
import { processEasyApplyQueue } from "../services/autoApply/applyQueue.js";
import {
  getApplyBrowserLoginStatus,
  isIndeedJobUrl,
  isLinkedInJobUrl,
} from "../services/apply/applyBrowserLogin.js";
import { getLinkedInBrowserLoginStatus } from "../services/apply/linkedinLogin.js";
import { getJobApplyCompletionState } from "../services/autoApply/jobCompletion.js";
import { clearAutoApplyData } from "../services/autoApply/clear.js";
import {
  getAutoApplyWatchStatus,
  setAutoApplyWatch,
} from "../services/autoApply/watch.js";

export const autoApplyRouter = Router();

autoApplyRouter.get("/linkedin-login", async (_req, res) => {
  res.json(await getLinkedInBrowserLoginStatus());
});

autoApplyRouter.get("/browser-login", async (_req, res) => {
  res.json(await getApplyBrowserLoginStatus());
});

autoApplyRouter.post("/open-job/:jobId", async (req, res) => {
  try {
    const doc = await JobModel.findById(req.params.jobId);
    if (!doc) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const { openUrlInAutomationBrowser } = await import("../services/apply/browserSession.js");
    const result = await openUrlInAutomationBrowser(doc.url);
    const login = await getApplyBrowserLoginStatus();
    const needsLinkedIn = isLinkedInJobUrl(doc.url) && !login.linkedIn.ready;
    const needsIndeed =
      (isIndeedJobUrl(doc.url) || doc.source === "indeed") && !login.indeed.ready;
    const loginNote = needsLinkedIn
      ? " Sign in on LinkedIn in that window if prompted (use Set up apply browser login on the dashboard first)."
      : needsIndeed
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

autoApplyRouter.get("/watch", async (_req, res) => {
  res.json(await getAutoApplyWatchStatus());
});

autoApplyRouter.patch("/watch", async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    const applyEnabled = req.body?.applyEnabled;
    const dryRun = req.body?.dryRun;
    const maxPerScan =
      req.body?.maxPerScan != null ? Number(req.body.maxPerScan) : undefined;
    const intervalMinutes =
      req.body?.intervalMinutes != null ? Number(req.body.intervalMinutes) : undefined;
    const status = await setAutoApplyWatch({
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

autoApplyRouter.post("/apply-queue", async (_req, res) => {
  try {
    const result = await processEasyApplyQueue();
    const status = await getAutoApplyWatchStatus();
    res.json({ ...result, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply queue failed";
    res.status(500).json({ error: message });
  }
});

autoApplyRouter.post("/clear", async (_req, res) => {
  try {
    const { logsRemoved, jobsRemoved } = await clearAutoApplyData();
    const status = await getAutoApplyWatchStatus();
    res.json({
      message: `Cleared ${jobsRemoved} Easy Apply jobs and ${logsRemoved} log entries`,
      logsRemoved,
      jobsRemoved,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not clear Auto Apply data";
    res.status(500).json({ error: message });
  }
});

autoApplyRouter.post("/scan", async (_req, res) => {
  try {
    const result = await collectLinkedInEasyApplyJobs();
    res.json({
      message: `Found ${result.found} Easy Apply jobs (${result.easyApplyInDb} in database)`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Easy Apply scan failed";
    res.status(500).json({ error: message });
  }
});

autoApplyRouter.get("/job-status/:jobId", async (req, res) => {
  const state = await getJobApplyCompletionState(req.params.jobId);
  res.json(state);
});

autoApplyRouter.get("/candidates", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 30), 50);
  const minAiScore = req.query.minAiScore != null ? Number(req.query.minAiScore) : undefined;
  const candidates = await listEasyApplyCandidates({ limit, minAiScore });
  res.json(candidates);
});

autoApplyRouter.get("/logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  res.json(await listAutoApplyLogs(limit));
});

autoApplyRouter.post("/run/:jobId", async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const headless = req.body?.headless === true;
    const skipAnalyze = req.body?.skipAnalyze === true;
    const skipTailor = req.body?.skipTailor === true;

    const result = await runLinkedInEasyApplyPipeline({
      jobId: req.params.jobId,
      dryRun,
      headless,
      skipAnalyze,
      skipTailor,
    });

    const message =
      result.status === "skipped" && result.message.startsWith("Already complete")
        ? result.message
        : result.submitted
          ? "LinkedIn Easy Apply submitted"
          : dryRun
            ? result.message
            : "Pipeline finished";

    res.json({ message, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto Apply failed";
    const status = /sign-in required/i.test(message) ? 401 : 500;
    res.status(status).json({ error: message });
  }
});
