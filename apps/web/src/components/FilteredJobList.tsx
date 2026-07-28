"use client";

import { CollectedJobCard } from "@/components/CollectedJobCard";
import type { JobDto } from "@jobfinder/shared";

export function FilteredJobList({
  initialJobs,
  emptyMessage = "No jobs to show.",
}: {
  initialJobs: JobDto[];
  emptyMessage?: string;
}) {
  if (initialJobs.length === 0) {
    return (
      <div className="card-flat py-8 text-center text-slate-500">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {initialJobs.map((job) => (
        <CollectedJobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
