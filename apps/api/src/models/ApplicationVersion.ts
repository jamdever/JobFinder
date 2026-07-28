import mongoose, { Schema, type InferSchemaType } from "mongoose";
import type { ApplicationVersionsDto } from "@jobfinder/shared";

const cvVersionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    keyChanges: { type: [String], default: [] },
    model: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const coverLetterVersionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    keyPoints: { type: [String], default: [] },
    model: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appliedRecordSchema = new Schema(
  {
    id: { type: String, required: true },
    appliedAt: { type: Date, default: Date.now },
    jobTitle: { type: String, required: true },
    company: { type: String, required: true },
    location: { type: String, default: "" },
    jobUrl: { type: String, required: true },
    originalCvText: { type: String, required: true },
    tailoredCvText: { type: String },
    coverLetterText: { type: String },
    tailoredCvVersionId: { type: String },
    coverLetterVersionId: { type: String },
    note: { type: String },
  },
  { _id: false }
);

const applicationVersionSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    originalCv: {
      text: { type: String, required: true },
      capturedAt: { type: Date, default: Date.now },
      resumeFileName: { type: String },
    },
    cvVersions: { type: [cvVersionSchema], default: [] },
    coverLetterVersions: { type: [coverLetterVersionSchema], default: [] },
    appliedRecords: { type: [appliedRecordSchema], default: [] },
    lastAppliedAt: { type: Date },
  },
  { timestamps: true }
);

applicationVersionSchema.index({ lastAppliedAt: -1 });

export type ApplicationVersionDocument = mongoose.HydratedDocument<
  InferSchemaType<typeof applicationVersionSchema>
>;

export const ApplicationVersionModel = mongoose.model(
  "ApplicationVersion",
  applicationVersionSchema,
  "ApplicationVersions"
);

export function toApplicationVersionsDto(
  doc: ApplicationVersionDocument,
  jobId: string
): ApplicationVersionsDto {
  return {
    jobId,
    originalCv: doc.originalCv?.text
      ? {
          text: doc.originalCv.text,
          capturedAt: doc.originalCv.capturedAt?.toISOString() ?? new Date().toISOString(),
          resumeFileName: doc.originalCv.resumeFileName ?? undefined,
        }
      : undefined,
    cvVersions: (doc.cvVersions ?? []).map((v) => ({
      id: v.id,
      text: v.text,
      keyChanges: v.keyChanges ?? [],
      model: v.model,
      createdAt: v.createdAt?.toISOString() ?? new Date().toISOString(),
    })),
    coverLetterVersions: (doc.coverLetterVersions ?? []).map((v) => ({
      id: v.id,
      text: v.text,
      keyPoints: v.keyPoints ?? [],
      model: v.model,
      createdAt: v.createdAt?.toISOString() ?? new Date().toISOString(),
    })),
    appliedRecords: (doc.appliedRecords ?? []).map((r) => ({
      id: r.id,
      appliedAt: r.appliedAt?.toISOString() ?? new Date().toISOString(),
      jobTitle: r.jobTitle,
      company: r.company,
      location: r.location ?? "",
      jobUrl: r.jobUrl,
      originalCvText: r.originalCvText,
      tailoredCvText: r.tailoredCvText ?? undefined,
      coverLetterText: r.coverLetterText ?? undefined,
      tailoredCvVersionId: r.tailoredCvVersionId ?? undefined,
      coverLetterVersionId: r.coverLetterVersionId ?? undefined,
      note: r.note ?? undefined,
    })),
    lastAppliedAt: doc.lastAppliedAt?.toISOString(),
  };
}
