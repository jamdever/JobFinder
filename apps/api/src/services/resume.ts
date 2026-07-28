import fs from "node:fs/promises";
import path from "node:path";
import type { UserProfile } from "@jobfinder/shared";
import { env } from "../config.js";
import { ProfileModel } from "../models/Profile.js";

const DEFAULT_KEY = "default";

async function resumeFileExists(resumePath: string): Promise<boolean> {
  const fullPath = path.isAbsolute(resumePath)
    ? resumePath
    : path.join(env.projectRoot, resumePath);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function resumeExists(profile: UserProfile): Promise<boolean> {
  const doc = await ProfileModel.findOne({ key: DEFAULT_KEY }).select("resumePdf resumePath");
  if (doc?.resumePdf?.length) return true;
  return resumeFileExists(profile.resumePath);
}

export async function getResumeMeta(profile: UserProfile): Promise<{
  hasResume: boolean;
  resumeFileName?: string;
}> {
  const doc = await ProfileModel.findOne({ key: DEFAULT_KEY }).select(
    "resumePdf resumeFileName resumePath"
  );
  const hasResume = await resumeExists(profile);
  const resumeFileName =
    doc?.resumeFileName ??
    (hasResume ? profile.resumePath.split(/[/\\]/).pop() : undefined);
  return { hasResume, resumeFileName };
}

export async function loadResumeBuffer(profile: UserProfile): Promise<Buffer> {
  const doc = await ProfileModel.findOne({ key: DEFAULT_KEY }).select("resumePdf resumePath");
  if (doc?.resumePdf?.length) {
    return Buffer.from(doc.resumePdf);
  }

  const resumePath = path.isAbsolute(profile.resumePath)
    ? profile.resumePath
    : path.join(env.projectRoot, profile.resumePath);

  try {
    return await fs.readFile(resumePath);
  } catch {
    throw new Error(
      "No CV found. Put a PDF in the resumes/ folder (see README)."
    );
  }
}
