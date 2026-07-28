import { api } from "@/lib/api";
import type { AppliedJobDto } from "@jobfinder/shared";

export const dynamic = "force-dynamic";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ApplicationsPage() {
  let applied: AppliedJobDto[] = [];
  let error = "";

  try {
    applied = await api.listAppliedJobs(50);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load applications";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Applied jobs</h1>
        <p className="mt-1 text-gray-400">Jobs marked as applied from Auto Apply.</p>
      </div>

      {error && (
        <div className="card border-red-800/50 text-red-300">
          <p>{error}</p>
        </div>
      )}

      {applied.length === 0 && !error && (
        <div className="card text-gray-400">
          <p>No applications recorded yet.</p>
          <p className="mt-2 text-sm">
            Applied jobs from Auto Apply will show up here.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {applied.map((row) => (
          <li key={row.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">{row.jobTitle}</h2>
                <p className="text-sm text-gray-400">
                  {row.company}
                  {row.location ? ` · ${row.location}` : ""}
                </p>
                <p className="mt-1 text-xs text-gray-500">Applied {formatWhen(row.appliedAt)}</p>
                {row.note && <p className="mt-2 text-sm text-gray-400">{row.note}</p>}
                <p className="mt-2 text-xs text-gray-500">
                  {row.hasTailoredCv && "Tailored CV saved · "}
                  {row.hasCoverLetter && "Cover letter saved"}
                  {!row.hasTailoredCv && !row.hasCoverLetter && "Original CV only"}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <a
                  href={row.jobUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost text-xs"
                >
                  Job posting
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
