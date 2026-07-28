import { Router } from "express";
import { listDashboardJobs } from "../services/jobList.js";

export const jobsRouter = Router();

jobsRouter.post("/:id/description", async (req, res) => {
  try {
    const { ensureJobDescription } = await import("../services/jobDescription.js");
    const description = await ensureJobDescription(req.params.id);
    res.json({ description });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load description";
    res.status(500).json({ error: message });
  }
});

jobsRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const jobs = await listDashboardJobs({ limit });
  res.json(jobs);
});
