import mongoose, { Schema, type InferSchemaType } from "mongoose";
import type { JobStatus, MatchRecommendation } from "@jobfinder/shared";

const jobSchema = new Schema(
  {
    externalId: { type: String, required: true },
    source: { type: String, required: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    location: { type: String, default: "" },
    url: { type: String, required: true },
    /** company|title|city — same role from Indeed + LinkedIn */
    dedupKey: { type: String },
    description: { type: String, default: "" },
    tags: { type: [String], default: [] },
    salary: { type: String, default: "" },
    workArrangement: {
      type: String,
      enum: ["remote", "hybrid", "on-site", "unknown"],
    },
    employmentType: {
      type: String,
      enum: ["internship", "graduate", "full-time", "part-time", "contract", "unknown"],
    },
    visaSponsorship: { type: String, enum: ["yes", "no", "unknown"] },
    techStack: { type: [String], default: [] },
    salaryMin: { type: Number },
    salaryMax: { type: Number },
    hasSalary: { type: Boolean },
    linkedInApplyType: {
      type: String,
      enum: ["easy_apply", "external", "unknown"],
    },
    indeedApplyType: {
      type: String,
      enum: ["easy_apply", "external", "unknown"],
    },
    matchScore: { type: Number, default: 0 },
    aiMatchScore: { type: Number },
    aiAnalyzedModel: { type: String },
    matchSummary: { type: String },
    matchStrengths: { type: [String], default: [] },
    matchGaps: { type: [String], default: [] },
    matchRecommendation: {
      type: String,
      enum: ["strong_match", "good_match", "moderate_match", "weak_match", "not_recommended"],
    },
    analyzedAt: { type: Date },
    tailoredCvMarkdown: { type: String },
    tailoredCvChanges: { type: [String], default: [] },
    tailoredCvAt: { type: Date },
    tailoredCvModel: { type: String },
    tailorErrorMessage: { type: String },
    status: {
      type: String,
      enum: [
        "discovered",
        "queued",
        "prepared",
        "applied",
        "skipped",
        "failed",
        "analyzed",
        "saved",
        "dismissed",
      ],
      default: "discovered",
    },
    coverLetter: { type: String },
    coverLetterKeyPoints: { type: [String], default: [] },
    coverLetterAt: { type: Date },
    coverLetterModel: { type: String },
    coverLetterErrorMessage: { type: String },
    atsScore: { type: Number },
    atsKeywordScore: { type: Number },
    atsMatchedKeywords: { type: [String], default: [] },
    atsMissingKeywords: { type: [String], default: [] },
    atsFormatIssues: { type: [String], default: [] },
    atsSuggestions: { type: [String], default: [] },
    atsSummary: { type: String },
    atsAt: { type: Date },
    atsModel: { type: String },
    atsErrorMessage: { type: String },
    screeningAnswers: { type: Map, of: String },
    errorMessage: { type: String },
    discoveredAt: { type: Date, default: Date.now },
    postedAt: { type: Date },
    appliedAt: { type: Date },
  },
  { timestamps: true }
);

jobSchema.index({ aiMatchScore: -1 });
jobSchema.index({ status: 1, matchScore: -1 });
jobSchema.index({ source: 1, externalId: 1 }, { unique: true });
jobSchema.index({ dedupKey: 1 }, { unique: true, sparse: true });
jobSchema.index({ url: 1 });
jobSchema.index({ analyzedAt: 1 });

export type JobDocument = InferSchemaType<typeof jobSchema> & { _id: mongoose.Types.ObjectId };

/** Uses your Atlas collection name `JobSearch` in database `JobSeachDB` */
export const JobModel = mongoose.model("Job", jobSchema, "JobSearch");

/** Fields omitted from list/dashboard payloads (large text). */
export const JOB_LIST_SELECT =
  "-tailoredCvMarkdown -coverLetter -screeningAnswers -atsSuggestions -atsFormatIssues";

export function toJobDto(doc: JobDocument) {
  return {
    id: doc._id.toString(),
    externalId: doc.externalId,
    source: doc.source,
    title: doc.title,
    company: doc.company,
    location: doc.location ?? "",
    url: doc.url,
    description: doc.description ?? "",
    tags: doc.tags ?? [],
    salary: doc.salary ?? "",
    workArrangement: doc.workArrangement,
    employmentType: doc.employmentType,
    visaSponsorship: doc.visaSponsorship,
    techStack: doc.techStack ?? [],
    salaryMin: doc.salaryMin ?? undefined,
    salaryMax: doc.salaryMax ?? undefined,
    hasSalary: doc.hasSalary,
    linkedInApplyType: doc.linkedInApplyType ?? undefined,
    indeedApplyType: doc.indeedApplyType ?? undefined,
    matchScore: doc.matchScore ?? 0,
    aiMatchScore: doc.aiMatchScore,
    aiAnalyzedModel: doc.aiAnalyzedModel,
    matchSummary: doc.matchSummary,
    matchStrengths: doc.matchStrengths ?? [],
    matchGaps: doc.matchGaps ?? [],
    matchRecommendation: doc.matchRecommendation as MatchRecommendation | undefined,
    analyzedAt: doc.analyzedAt?.toISOString(),
    tailoredCvMarkdown: doc.tailoredCvMarkdown,
    tailoredCvChanges: doc.tailoredCvChanges ?? [],
    tailoredCvAt: doc.tailoredCvAt?.toISOString(),
    tailoredCvModel: doc.tailoredCvModel,
    tailorErrorMessage: doc.tailorErrorMessage,
    status: doc.status as JobStatus,
    coverLetter: doc.coverLetter,
    coverLetterKeyPoints: doc.coverLetterKeyPoints ?? [],
    coverLetterAt: doc.coverLetterAt?.toISOString(),
    coverLetterModel: doc.coverLetterModel,
    coverLetterErrorMessage: doc.coverLetterErrorMessage,
    atsScore: doc.atsScore,
    atsKeywordScore: doc.atsKeywordScore,
    atsMatchedKeywords: doc.atsMatchedKeywords ?? [],
    atsMissingKeywords: doc.atsMissingKeywords ?? [],
    atsFormatIssues: doc.atsFormatIssues ?? [],
    atsSuggestions: doc.atsSuggestions ?? [],
    atsSummary: doc.atsSummary,
    atsAt: doc.atsAt?.toISOString(),
    atsModel: doc.atsModel,
    atsErrorMessage: doc.atsErrorMessage,
    screeningAnswers: doc.screeningAnswers
      ? Object.fromEntries(doc.screeningAnswers as Map<string, string>)
      : undefined,
    errorMessage: doc.errorMessage,
    discoveredAt: doc.discoveredAt?.toISOString() ?? new Date().toISOString(),
    postedAt: doc.postedAt?.toISOString(),
    appliedAt: doc.appliedAt?.toISOString(),
  };
}

/** Lighter DTO for job lists (keeps description; omits CV/cover letter blobs). */
export function toJobListDto(doc: JobDocument) {
  const dto = toJobDto(doc);
  return {
    ...dto,
    tailoredCvMarkdown: undefined,
    coverLetter: undefined,
    screeningAnswers: undefined,
  };
}
