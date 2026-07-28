import {
  formatSearchLocationsLabel,
  getSearchCounties,
  type UserProfile,
} from "@jobfinder/shared";
import Link from "next/link";
import { isSearchConfigured } from "@/lib/search";

export function SearchCriteriaBanner({ profile }: { profile: UserProfile | null }) {
  if (!profile || isSearchConfigured(profile)) return null;

  return (
    <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-sm">
      <p className="font-medium text-amber-100">Search not configured</p>
      <p className="mt-1 text-amber-200/80">
        Add job titles and boards before collecting.
      </p>
      <Link
        href="/settings"
        className="btn-primary mt-3 inline-block text-sm"
      >
        Open Settings
      </Link>
    </div>
  );
}

export function SearchCriteriaSummary({ profile }: { profile: UserProfile }) {
  if (!isSearchConfigured(profile)) return null;

  const { titles, maxPostedDays } = profile.preferences;
  const boards = profile.search.sources.join(", ");
  const locationLabel = formatSearchLocationsLabel(
    profile.search.country ?? "Ireland",
    getSearchCounties(profile.search.counties, profile.search.county)
  );

  return (
    <div className="card-flat flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Active search
        </p>
        <p className="mt-1 font-medium text-slate-200">
          {titles.filter((t) => t.trim()).join(" · ") || "—"}
        </p>
        <p className="mt-0.5 text-slate-500">
          {locationLabel} · {boards} · {maxPostedDays ?? 7}d
        </p>
      </div>
      <Link href="/settings" className="btn-ghost shrink-0 text-sm">
        Edit
      </Link>
    </div>
  );
}
