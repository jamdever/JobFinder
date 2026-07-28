import mongoose, { Schema, type InferSchemaType } from "mongoose";
import type { AutoApplyLogDto, AutoApplyRunStatus, AutoApplyStage } from "@jobfinder/shared";

const autoApplyLogSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    jobTitle: { type: String, required: true },
    company: { type: String, required: true },
    jobUrl: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "success", "failed", "skipped"],
      default: "pending",
    },
    stage: { type: String, default: "queued" },
    message: { type: String, default: "" },
    submitted: { type: Boolean, default: false },
    dryRun: { type: Boolean, default: true },
    aiMatchScore: { type: Number },
    result: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export type AutoApplyLogDoc = InferSchemaType<typeof autoApplyLogSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AutoApplyLogModel =
  mongoose.models.AutoApplyLog ?? mongoose.model("AutoApplyLog", autoApplyLogSchema);

export function toAutoApplyLogDto(doc: AutoApplyLogDoc): AutoApplyLogDto {
  return {
    id: String(doc._id),
    jobId: String(doc.jobId),
    jobTitle: doc.jobTitle,
    company: doc.company,
    jobUrl: doc.jobUrl,
    status: doc.status as AutoApplyRunStatus,
    stage: doc.stage as AutoApplyStage,
    message: doc.message ?? "",
    submitted: doc.submitted ?? false,
    dryRun: doc.dryRun ?? true,
    aiMatchScore: doc.aiMatchScore ?? undefined,
    result: doc.result as AutoApplyLogDto["result"],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
