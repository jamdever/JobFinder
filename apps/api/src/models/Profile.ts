import mongoose, { Schema } from "mongoose";
import type { UserProfile } from "@jobfinder/shared";

const profileSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true },
    personal: {
      fullName: String,
      email: String,
      phone: String,
      location: String,
      linkedinUrl: String,
      portfolioUrl: String,
      githubUrl: String,
    },
    resumePath: { type: String, default: "resumes/resume.pdf" },
    /** PDF bytes stored in Atlas so CV survives restarts and new machines */
    resumePdf: { type: Buffer },
    resumeFileName: { type: String },
    preferences: {
      titles: { type: [String], default: ["Junior Software Developer"] },
      keywords: { type: [String], default: [] },
      excludeKeywords: { type: [String], default: [] },
      locations: { type: [String], default: ["Ireland"] },
      maxPostedDays: { type: Number, default: 7 },
      minMatchScore: { type: Number, default: 0.55 },
      maxApplicationsPerDay: { type: Number, default: 15 },
    },
    application: {
      coverLetterTone: { type: String, default: "professional and concise" },
      defaultAnswerMaxWords: { type: Number, default: 120 },
      requireSubmitConfirmation: { type: Boolean, default: true },
      delayBetweenApplications: { type: Number, default: 5 },
      autoApplyFastMode: { type: Boolean, default: true },
      autoApplyWatchEnabled: { type: Boolean, default: false },
      autoApplyWatchIntervalMinutes: { type: Number, default: 15 },
      autoApplyWatchApplyEnabled: { type: Boolean, default: false },
      autoApplyWatchDryRun: { type: Boolean, default: false },
      autoApplyWatchMaxPerScan: { type: Number, default: 3 },
      linkedInBrowserLoginAt: { type: String },
      indeedBrowserLoginAt: { type: String },
      indeedCloudflareUnlockedAt: { type: String },
      indeedAutoApplyWatchEnabled: { type: Boolean, default: false },
      indeedAutoApplyWatchIntervalMinutes: { type: Number, default: 15 },
      indeedAutoApplyWatchApplyEnabled: { type: Boolean, default: false },
      indeedAutoApplyWatchDryRun: { type: Boolean, default: false },
      indeedAutoApplyWatchMaxPerScan: { type: Number, default: 3 },
    },
    search: {
      sources: { type: [String], default: ["indeed", "linkedin"] },
      country: { type: String, default: "Ireland" },
      county: { type: String, default: "" },
      counties: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

export const ProfileModel = mongoose.model("Profile", profileSchema);

export function docToProfile(doc: InstanceType<typeof ProfileModel>): UserProfile {
  return {
    personal: {
      fullName: doc.personal?.fullName ?? "",
      email: doc.personal?.email ?? "",
      phone: doc.personal?.phone ?? undefined,
      location: doc.personal?.location ?? undefined,
      linkedinUrl: doc.personal?.linkedinUrl ?? undefined,
      portfolioUrl: doc.personal?.portfolioUrl ?? undefined,
      githubUrl: doc.personal?.githubUrl ?? undefined,
    },
    resumePath: doc.resumePath ?? "resumes/resume.pdf",
    preferences: {
      titles: doc.preferences?.titles?.length
        ? doc.preferences.titles
        : ["Junior Software Developer"],
      keywords: doc.preferences?.keywords ?? [],
      excludeKeywords: doc.preferences?.excludeKeywords ?? [],
      locations: doc.preferences?.locations?.length
        ? doc.preferences.locations
        : ["Ireland"],
      maxPostedDays: doc.preferences?.maxPostedDays ?? 7,
      minMatchScore: doc.preferences?.minMatchScore ?? 0.55,
      maxApplicationsPerDay: doc.preferences?.maxApplicationsPerDay ?? 15,
    },
    application: {
      coverLetterTone: doc.application?.coverLetterTone ?? "professional and concise",
      defaultAnswerMaxWords: doc.application?.defaultAnswerMaxWords ?? 120,
      requireSubmitConfirmation: doc.application?.requireSubmitConfirmation ?? true,
      delayBetweenApplications: doc.application?.delayBetweenApplications ?? 5,
      autoApplyFastMode: doc.application?.autoApplyFastMode !== false,
      autoApplyWatchEnabled: doc.application?.autoApplyWatchEnabled ?? false,
      autoApplyWatchIntervalMinutes: doc.application?.autoApplyWatchIntervalMinutes ?? 15,
      autoApplyWatchApplyEnabled: doc.application?.autoApplyWatchApplyEnabled ?? false,
      autoApplyWatchDryRun: doc.application?.autoApplyWatchDryRun !== false,
      autoApplyWatchMaxPerScan: doc.application?.autoApplyWatchMaxPerScan ?? 2,
      linkedInBrowserLoginAt: doc.application?.linkedInBrowserLoginAt ?? undefined,
      indeedBrowserLoginAt: doc.application?.indeedBrowserLoginAt ?? undefined,
      indeedCloudflareUnlockedAt: doc.application?.indeedCloudflareUnlockedAt ?? undefined,
      indeedAutoApplyWatchEnabled: doc.application?.indeedAutoApplyWatchEnabled ?? false,
      indeedAutoApplyWatchIntervalMinutes:
        doc.application?.indeedAutoApplyWatchIntervalMinutes ?? 15,
      indeedAutoApplyWatchApplyEnabled:
        doc.application?.indeedAutoApplyWatchApplyEnabled ?? false,
      indeedAutoApplyWatchDryRun: doc.application?.indeedAutoApplyWatchDryRun !== false,
      indeedAutoApplyWatchMaxPerScan: doc.application?.indeedAutoApplyWatchMaxPerScan ?? 2,
    },
    search: {
      sources: normalizeSources(doc.search?.sources),
      country: doc.search?.country ?? "Ireland",
      county: doc.search?.county ?? "",
      counties: doc.search?.counties?.length
        ? doc.search.counties
        : doc.search?.county
          ? [doc.search.county]
          : [],
    },
  };
}

function normalizeSources(sources?: string[]): string[] {
  if (!sources?.length) return ["indeed", "linkedin"];
  const mapped = sources
    .map((s) => {
      if (s === "remotive" || s === "remoteok") return "indeed";
      return s;
    })
    .filter((s) => s !== "jobsie" && s !== "jobs.ie");
  return mapped.length ? mapped : ["indeed", "linkedin"];
}
