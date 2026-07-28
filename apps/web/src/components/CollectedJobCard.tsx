import { formatJobSource, jobSourceBadgeClass } from "@/lib/jobSource";
import { JobDescriptionCollapsible } from "@/components/JobDescriptionCollapsible";
import {
  resolveWorkArrangement,
  workArrangementClass,
  workArrangementLabel,
} from "@/lib/workArrangement";
import {
  isLinkedInJob,
  LINKEDIN_APPLY_TYPE_LABELS,
  resolveLinkedInApplyType,
  type JobDto,
} from "@jobfinder/shared";
import { ApplyToJobButton } from "@/components/ApplyToJobButton";

function formatSalary(salary: string | undefined): string | null {
  const s = salary?.trim();
  if (!s || /^not listed$/i.test(s)) return null;
  return s;
}

export function CollectedJobCard({ job }: { job: JobDto }) {
  const company = job.company?.trim() || "Company not listed";
  const location = job.location?.trim() || "—";
  const salary = formatSalary(job.salary);
  const arrangement = resolveWorkArrangement(job);
  const linkedInApply = resolveLinkedInApplyType(job);
  const siteLabel = formatJobSource(job.source, job.url);

  return (
    <article className="card-flat flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="text-base font-semibold leading-snug text-slate-100">{job.title}</h3>
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${jobSourceBadgeClass(job.source, job.url)}`}
          >
            {siteLabel}
          </span>
          {arrangement !== "unknown" && (
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${workArrangementClass(arrangement)}`}
            >
              {workArrangementLabel(arrangement)}
            </span>
          )}
          {isLinkedInJob(job) && linkedInApply && linkedInApply !== "unknown" && (
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                linkedInApply === "easy_apply"
                  ? "border-emerald-800/60 bg-emerald-950/50 text-emerald-300"
                  : "border-amber-800/50 bg-amber-950/40 text-amber-200"
              }`}
            >
              {LINKEDIN_APPLY_TYPE_LABELS[linkedInApply]}
            </span>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Company</dt>
            <dd className="break-words text-slate-200">{company}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Location</dt>
            <dd className="break-words text-slate-200">{location}</dd>
          </div>
          {salary && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Salary</dt>
              <dd className="text-slate-200">{salary}</dd>
            </div>
          )}
        </dl>

        <JobDescriptionCollapsible
          jobId={job.id}
          description={job.description}
          jobUrl={job.url}
        />
      </div>

      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:max-w-[12.5rem] sm:items-stretch">
        <ApplyToJobButton job={job} />
      </div>
    </article>
  );
}
