import { Router } from "express";
import { getProfile, updateProfile } from "../services/profile.js";
import { getResumeMeta } from "../services/resume.js";

export const profileRouter = Router();

async function profileResponse(profile: Awaited<ReturnType<typeof getProfile>>) {
  const meta = await getResumeMeta(profile);
  return { ...profile, ...meta };
}

profileRouter.get("/", async (_req, res) => {
  const profile = await getProfile();
  res.json(await profileResponse(profile));
});

profileRouter.put("/", async (req, res) => {
  const profile = await updateProfile(req.body);
  res.json(await profileResponse(profile));
});
