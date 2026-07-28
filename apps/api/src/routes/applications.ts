import { Router } from "express";
import { listAppliedJobs } from "../services/versionTracking.js";

export const applicationsRouter = Router();

applicationsRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const applied = await listAppliedJobs(limit);
  res.json(applied);
});
