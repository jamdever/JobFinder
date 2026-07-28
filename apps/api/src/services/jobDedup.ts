import type { JobListingInput } from "@jobfinder/shared";
import { JobModel, type JobDocument } from "../models/Job.js";

function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(ltd|limited|inc|plc|co|group|ireland)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First place name (e.g. "Tralee, County Kerry" → "tralee"). */
function normalizeLocationCity(location: string): string {
  const raw = location.trim().toLowerCase();
  if (!raw || raw === "ireland") return "";
  const first = raw.split(",")[0]?.trim() ?? raw;
  return first.replace(/\s+/g, " ");
}

/** LinkedIn job id from view URL or externalId (same posting, different location text). */
export function parseLinkedInJobId(job: {
  url?: string;
  externalId?: string;
}): string | null {
  for (const raw of [job.url ?? "", job.externalId ?? ""]) {
    if (!raw) continue;
    const fromPath = raw.match(/(?:jobs\/view\/|jobPosting\/|currentJobId=)(\d{8,})/i)?.[1];
    if (fromPath) return fromPath;
    const digitsOnly = raw.match(/^(\d{8,})$/);
    if (digitsOnly) return digitsOnly[1];
    const embedded = raw.match(/(\d{10,})/);
    if (embedded) return embedded[1];
  }
  return null;
}

export type JobDedupInput = {
  title: string;
  company: string;
  location?: string;
  source?: string;
  url?: string;
  externalId?: string;
};

export function jobDedupKey(job: JobDedupInput): string {
  const company = normalizeCompany(job.company || "unknown");
  const title = normalizeTitle(job.title || "unknown");

  if (job.source === "linkedin") {
    const liId = parseLinkedInJobId(job);
    if (liId) return `linkedin:${liId}`;
    return `linkedin:${company}:${title}`;
  }

  const city = normalizeLocationCity(job.location ?? "");
  return `${company}|${title}|${city}`;
}

/** Find an existing row for this listing (dedup key, URL, or LinkedIn job id). */
export async function findExistingJobForListing(
  listing: JobDedupInput & { url?: string; externalId?: string; source?: string }
): Promise<JobDocument | null> {
  const dedupKey = jobDedupKey(listing);
  const byKey = await JobModel.findOne({ dedupKey });
  if (byKey) return byKey;

  if (listing.url?.trim()) {
    const url = listing.url.trim();
    const byUrl = await JobModel.findOne({ url });
    if (byUrl) return byUrl;

    const liId = listing.source === "linkedin" ? parseLinkedInJobId(listing) : null;
    if (liId) {
      const byLi = await JobModel.findOne({
        source: "linkedin",
        $or: [{ url: { $regex: liId } }, { externalId: liId }],
      });
      if (byLi) return byLi;
    }
  }

  return null;
}

export function normalizeJobUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Prefer city-level location over bare "Ireland". */
export function preferRicherLocation(a: string, b: string): string {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left) return right;
  if (!right) return left;
  const leftNational = left.toLowerCase() === "ireland";
  const rightNational = right.toLowerCase() === "ireland";
  if (leftNational && !rightNational) return right;
  if (rightNational && !leftNational) return left;
  return left.length >= right.length ? left : right;
}

/** Drop duplicate listings in one collect batch (different boards, same role). */
export function dedupeListings(listings: JobListingInput[]): JobListingInput[] {
  const byKey = new Map<string, JobListingInput>();

  for (const listing of listings) {
    const key = jobDedupKey(listing);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, listing);
      continue;
    }
    const pick = pickBetterListing(existing, listing);
    byKey.set(key, {
      ...pick,
      location: preferRicherLocation(existing.location ?? "", listing.location ?? ""),
    });
  }

  return [...byKey.values()];
}

function pickBetterListing(a: JobListingInput, b: JobListingInput): JobListingInput {
  const aDesc = (a.description ?? "").length;
  const bDesc = (b.description ?? "").length;
  if (bDesc > aDesc + 40) return b;
  if (aDesc > bDesc + 40) return a;
  if ((b.salary ?? "").trim() && !(a.salary ?? "").trim()) return b;
  return a;
}

function jobRichness(doc: {
  analyzedAt?: Date | null;
  aiMatchScore?: number | null;
  description?: string | null;
  matchStrengths?: string[] | null;
  tailoredCvMarkdown?: string | null;
}): number {
  let score = 0;
  if (doc.analyzedAt) score += 1000;
  score += (doc.aiMatchScore ?? 0) * 2;
  score += (doc.description ?? "").length;
  score += (doc.matchStrengths?.length ?? 0) * 10;
  if (doc.tailoredCvMarkdown) score += 50;
  return score;
}

/** Remove duplicate MongoDB rows (same role / same LinkedIn posting). Keeps the richest record. */
export async function mergeDuplicateJobsInDatabase(): Promise<number> {
  const docs = await JobModel.find({}).lean();
  const groups = new Map<string, typeof docs>();

  for (const doc of docs) {
    const key = jobDedupKey({
      title: doc.title,
      company: doc.company,
      location: doc.location ?? "",
      source: doc.source,
      url: doc.url,
      externalId: doc.externalId,
    });
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }

  let removed = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    const sorted = [...group].sort((a, b) => jobRichness(b) - jobRichness(a));
    const keeper = sorted[0];
    const keeperId = keeper._id;

    let location = keeper.location ?? "";
    let url = keeper.url;
    let description = keeper.description ?? "";
    for (let i = 1; i < sorted.length; i++) {
      const dup = sorted[i];
      location = preferRicherLocation(location, dup.location ?? "");
      if ((dup.description ?? "").length > description.length) {
        description = dup.description ?? "";
      }
      if ((dup.url ?? "").length > (url ?? "").length) url = dup.url;
    }

    const dedupKey = jobDedupKey({
      title: keeper.title,
      company: keeper.company,
      location,
      source: keeper.source,
      url,
      externalId: keeper.externalId,
    });

    await JobModel.updateOne(
      { _id: keeperId },
      { $set: { dedupKey, location, url, description } }
    );

    for (let i = 1; i < sorted.length; i++) {
      await JobModel.deleteOne({ _id: sorted[i]._id });
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[dedup] removed ${removed} duplicate job listing(s)`);
  }
  return removed;
}

export function dedupeJobDocs<
  T extends {
    title: string;
    company: string;
    location?: string | null;
    source?: string;
    url?: string;
    externalId?: string;
    aiMatchScore?: number | null;
  },
>(jobs: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const job of jobs) {
    const key = jobDedupKey({
      title: job.title,
      company: job.company,
      location: job.location ?? undefined,
      source: job.source,
      url: job.url,
      externalId: job.externalId,
    });
    const existing = byKey.get(key);
    if (!existing || (job.aiMatchScore ?? 0) > (existing.aiMatchScore ?? 0)) {
      byKey.set(key, job);
    }
  }
  return [...byKey.values()];
}
