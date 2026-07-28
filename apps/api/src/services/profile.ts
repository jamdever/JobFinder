import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import type { UserProfile } from "@jobfinder/shared";
import {
  buildPreferenceLocations,
  DEFAULT_SEARCH_COUNTRY,
  getSearchCounties,
} from "@jobfinder/shared";
import { env } from "../config.js";
import { docToProfile, ProfileModel } from "../models/Profile.js";
import { parsePdfText } from "./pdfText.js";
import { loadResumeBuffer } from "./resume.js";

const DEFAULT_KEY = "default";

function yamlToProfile(data: Record<string, unknown>): UserProfile {
  const personal = data.personal as Record<string, string>;
  const resume = data.resume as { path: string };
  const preferences = data.preferences as UserProfile["preferences"] & {
    exclude_keywords?: string[];
  };
  const application = data.application as UserProfile["application"];
  const search = data.search as UserProfile["search"];

  return {
    personal: {
      fullName: personal?.full_name ?? personal?.fullName ?? "",
      email: personal?.email ?? "",
      phone: personal?.phone,
      location: personal?.location,
      linkedinUrl: personal?.linkedin_url ?? personal?.linkedinUrl,
      portfolioUrl: personal?.portfolio_url ?? personal?.portfolioUrl,
      githubUrl: personal?.github_url ?? personal?.githubUrl,
    },
    resumePath: resume?.path ?? "resumes/resume.pdf",
    preferences: {
      titles: preferences?.titles?.length
        ? preferences.titles
        : ["Junior Software Developer"],
      keywords: preferences?.keywords ?? [],
      excludeKeywords: preferences?.excludeKeywords ?? preferences?.exclude_keywords ?? [],
      locations: preferences?.locations?.length ? preferences.locations : ["Ireland"],
      maxPostedDays:
        (preferences as { maxPostedDays?: number; max_posted_days?: number })?.maxPostedDays ??
        (preferences as { max_posted_days?: number })?.max_posted_days ??
        7,
      minMatchScore: preferences?.minMatchScore ?? 0.55,
      maxApplicationsPerDay: preferences?.maxApplicationsPerDay ?? 15,
    },
    application: {
      coverLetterTone: application?.coverLetterTone ?? "professional and concise",
      defaultAnswerMaxWords: application?.defaultAnswerMaxWords ?? 120,
      requireSubmitConfirmation: application?.requireSubmitConfirmation ?? true,
      delayBetweenApplications: application?.delayBetweenApplications ?? 5,
      autoApplyFastMode: application?.autoApplyFastMode !== false,
      autoApplyWatchEnabled: application?.autoApplyWatchEnabled ?? false,
      autoApplyWatchIntervalMinutes: application?.autoApplyWatchIntervalMinutes ?? 15,
      autoApplyWatchApplyEnabled: application?.autoApplyWatchApplyEnabled ?? false,
      autoApplyWatchDryRun: application?.autoApplyWatchDryRun !== false,
      autoApplyWatchMaxPerScan: application?.autoApplyWatchMaxPerScan ?? 3,
    },
    search: {
      sources: search?.sources?.length
        ? search.sources.filter(
            (s) =>
              s !== "remotive" && s !== "remoteok" && s !== "jobsie" && s !== "jobs.ie"
          )
        : ["indeed", "linkedin"],
      country: (search as { country?: string })?.country ?? DEFAULT_SEARCH_COUNTRY,
      county: (search as { county?: string })?.county ?? "",
      counties: (search as { counties?: string[] })?.counties ?? [],
    },
  };
}

function syncSearchLocations(profile: UserProfile): UserProfile {
  const country = profile.search.country?.trim() || DEFAULT_SEARCH_COUNTRY;
  const counties = getSearchCounties(profile.search.counties, profile.search.county);
  return {
    ...profile,
    search: { ...profile.search, country, counties, county: counties[0] ?? "" },
    preferences: {
      ...profile.preferences,
      locations: buildPreferenceLocations(country, counties),
    },
  };
}

export async function getProfile(): Promise<UserProfile> {
  let doc = await ProfileModel.findOne({ key: DEFAULT_KEY });
  if (!doc) {
    const yamlPath = path.join(env.configDir, "profile.yaml");
    try {
      const raw = await fs.readFile(yamlPath, "utf-8");
      const parsed = yaml.parse(raw) as Record<string, unknown>;
      const profile = yamlToProfile(parsed);
      doc = await ProfileModel.create({
        key: DEFAULT_KEY,
        personal: profile.personal,
        resumePath: profile.resumePath,
        preferences: profile.preferences,
        application: profile.application,
        search: profile.search,
      });
    } catch {
      doc = await ProfileModel.create({
        key: DEFAULT_KEY,
        personal: { fullName: "", email: "" },
        resumePath: "resumes/resume.pdf",
      });
    }
  }
  const profile = docToProfile(doc);
  return syncSearchLocations(migrateProfile(profile));
}

/** Normalize legacy profiles (remotive/remoteok, missing Ireland fields). */
function migrateProfile(profile: UserProfile): UserProfile {
  const legacySources = profile.search.sources.some((s) =>
    ["remotive", "remoteok"].includes(s)
  );
  if (
    legacySources ||
    profile.preferences.maxPostedDays == null ||
    !profile.preferences.locations.includes("Ireland")
  ) {
    return {
      ...profile,
      preferences: {
        ...profile.preferences,
        titles: profile.preferences.titles.length
          ? profile.preferences.titles.map((t) => t.trim()).filter(Boolean)
          : ["Junior Software Developer"],
        maxPostedDays: profile.preferences.maxPostedDays ?? 7,
        keywords: [],
      },
      search: {
        sources: ["indeed", "linkedin"],
        country: profile.search.country ?? DEFAULT_SEARCH_COUNTRY,
        counties: getSearchCounties(profile.search.counties, profile.search.county),
        county: profile.search.county ?? "",
      },
    };
  }
  return syncSearchLocations(profile);
}

export async function updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  const current = await getProfile();
  const merged: UserProfile = syncSearchLocations({
    personal: { ...current.personal, ...updates.personal },
    resumePath: updates.resumePath ?? current.resumePath,
    preferences: { ...current.preferences, ...updates.preferences },
    application: { ...current.application, ...updates.application },
    search: { ...current.search, ...updates.search },
  });

  const doc = await ProfileModel.findOneAndUpdate(
    { key: DEFAULT_KEY },
    {
      $set: {
        personal: merged.personal,
        resumePath: merged.resumePath,
        preferences: merged.preferences,
        application: merged.application,
        search: merged.search,
      },
    },
    { new: true, upsert: true }
  );
  return docToProfile(doc!);
}

export async function loadResumeText(profile: UserProfile): Promise<string> {
  const buffer = await loadResumeBuffer(profile);
  const ext = path.extname(profile.resumePath).toLowerCase() || ".pdf";

  if (ext === ".pdf") {
    return parsePdfText(buffer);
  }
  if (ext === ".txt" || ext === ".md") {
    return buffer.toString("utf-8").trim();
  }
  throw new Error(`Unsupported resume format: ${ext}`);
}
