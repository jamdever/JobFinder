import { JobModel } from "../models/Job.js";
import {
  indeedViewJobUrl,
  fetchIndeedDescriptionStandalone,
} from "./search/indeedDetail.js";

const MIN_STORED_LEN = 120;

/** Fetch full description from the board if missing, save to DB, return text. */
export async function ensureJobDescription(jobId: string): Promise<string> {
  const doc = await JobModel.findById(jobId);
  if (!doc) throw new Error("Job not found");

  const existing = (doc.description ?? "").trim();
  if (existing.length >= MIN_STORED_LEN) return existing;

  if (doc.source !== "indeed" && !/indeed\.com/i.test(doc.url)) {
    throw new Error("Full description fetch is only supported for Indeed jobs right now.");
  }

  const viewUrl = indeedViewJobUrl({ url: doc.url, externalId: doc.externalId });
  const desc = await fetchIndeedDescriptionStandalone(viewUrl);
  if (desc.length < 40) {
    throw new Error("Indeed did not return a description for this posting.");
  }

  await JobModel.updateOne({ _id: doc._id }, { $set: { description: desc } });
  console.log(`[jobs] fetched Indeed description for ${doc.title} (${desc.length} chars)`);
  return desc;
}
