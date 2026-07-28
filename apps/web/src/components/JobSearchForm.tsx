"use client";

import { TagInput } from "@/components/TagInput";
import {
  buildPreferenceLocations,
  DEFAULT_SEARCH_COUNTRY,
  formatSearchLocationsLabel,
  getSearchCounties,
  IRELAND_COUNTIES,
  type UserProfile,
} from "@jobfinder/shared";

const JOB_SOURCES = [
  { id: "indeed", label: "Indeed" },
  { id: "linkedin", label: "LinkedIn" },
] as const;

const POSTED_WITHIN_OPTIONS = [
  { days: 1, label: "Last 24 hours" },
  { days: 3, label: "Last 3 days" },
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
];

const COUNTRY_OPTIONS = [{ id: "Ireland", label: "Ireland" }] as const;

/** One chip per title (case-insensitive); avoids duplicate keys and double-remove. */
export function normalizeJobTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  return titles
    .map((t) => t.trim())
    .filter((t) => {
      if (!t) return false;
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function JobSearchForm({
  profile,
  onChange,
}: {
  profile: UserProfile;
  onChange: (profile: UserProfile) => void;
}) {
  const prefs = profile.preferences;
  const search = profile.search;
  const jobTitles = normalizeJobTitles(prefs.titles);
  const country = search.country?.trim() || DEFAULT_SEARCH_COUNTRY;
  const counties = getSearchCounties(search.counties, search.county);

  function patchPreferences(partial: Partial<UserProfile["preferences"]>) {
    onChange({
      ...profile,
      preferences: { ...profile.preferences, ...partial },
    });
  }

  function setTitles(titles: string[]) {
    patchPreferences({ titles: normalizeJobTitles(titles) });
  }

  function setSearchLocations(nextCountry: string, nextCounties: string[]) {
    const list = getSearchCounties(nextCounties);
    onChange({
      ...profile,
      search: {
        ...search,
        country: nextCountry,
        counties: list,
        county: list[0] ?? "",
      },
      preferences: {
        ...prefs,
        locations: buildPreferenceLocations(nextCountry, list),
      },
    });
  }

  function addCounty(name: string) {
    const c = getSearchCounties([name])[0];
    if (!c) return;
    if (counties.some((x) => x.toLowerCase() === c.toLowerCase())) return;
    setSearchLocations(country, [...counties, c]);
  }

  function removeCounty(name: string) {
    setSearchLocations(
      country,
      counties.filter((c) => c.toLowerCase() !== name.toLowerCase())
    );
  }

  function setSearch(partial: Partial<UserProfile["search"]>) {
    onChange({ ...profile, search: { ...search, ...partial } });
  }

  function setMaxPostedDays(days: number) {
    patchPreferences({ maxPostedDays: days });
  }

  function toggleSource(sourceId: string) {
    const sources = new Set(search.sources);
    if (sources.has(sourceId)) sources.delete(sourceId);
    else sources.add(sourceId);
    setSearch({ sources: [...sources] });
  }

  const locationLabel = formatSearchLocationsLabel(country, counties);

  return (
    <div className="space-y-8">
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold text-white">Job titles</h2>
        <TagInput
          label="Titles *"
          hint="Press Enter after each title"
          tags={jobTitles}
          onChange={setTitles}
          placeholder="Junior Software Developer"
        />
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold text-white">Location</h2>
        <label className="block">
          <span className="text-sm text-gray-400">Country</span>
          <select
            className="mt-1 w-full rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-white"
            value={country}
            onChange={(e) => setSearchLocations(e.target.value, counties)}
          >
            {COUNTRY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <span className="text-sm text-gray-400">Counties</span>
          <div className="flex min-h-[2.75rem] flex-wrap gap-2 rounded-lg border border-ink-800 bg-ink-950 p-3">
            {counties.length === 0 ? (
              <span className="text-sm text-gray-500">All Ireland (add counties to narrow)</span>
            ) : (
              counties.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-sm text-gray-200"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => removeCounty(c)}
                    className="text-gray-500 hover:text-white"
                    aria-label={`Remove ${c}`}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <select
            className="w-full rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-white"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) addCounty(v);
              e.currentTarget.selectedIndex = 0;
            }}
          >
            <option value="">Add county…</option>
            {IRELAND_COUNTIES.filter(
              (name) => !counties.some((c) => c.toLowerCase() === name.toLowerCase())
            ).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-gray-500">
          Searching in: <span className="text-gray-300">{locationLabel}</span>
        </p>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Where to search</h2>
          <p className="mt-1 text-sm text-gray-400">Pick which boards to check.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {JOB_SOURCES.map((src) => (
            <label
              key={src.id}
              className={`cursor-pointer rounded-lg border px-4 py-2 text-sm transition ${
                search.sources.includes(src.id)
                  ? "border-accent bg-accent/10 text-white"
                  : "border-ink-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={search.sources.includes(src.id)}
                onChange={() => toggleSource(src.id)}
              />
              {src.label}
            </label>
          ))}
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">How fresh?</h2>
          <p className="mt-1 text-sm text-gray-400">
            Only include jobs posted within this window.
          </p>
        </div>
        <label className="block">
          <span className="text-sm text-gray-400">Posted within</span>
          <select
            className="mt-1 w-full rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-white"
            value={prefs.maxPostedDays ?? 7}
            onChange={(e) => setMaxPostedDays(Number(e.target.value))}
          >
            {POSTED_WITHIN_OPTIONS.map((opt) => (
              <option key={opt.days} value={opt.days}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <SearchPreview profile={profile} jobTitles={jobTitles} locationLabel={locationLabel} />
    </div>
  );
}

function SearchPreview({
  profile,
  jobTitles,
  locationLabel,
}: {
  profile: UserProfile;
  jobTitles: string[];
  locationLabel: string;
}) {
  const sources = profile.search.sources
    .map((s) => JOB_SOURCES.find((b) => b.id === s)?.label ?? s)
    .join(", ");

  if (!jobTitles.length) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
        Add at least one job title to start searching.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/50 px-4 py-3 text-sm text-gray-400">
      <p className="font-medium text-gray-300">We will search for:</p>
      <ul className="mt-2 list-inside list-disc space-y-1">
        <li>
          <strong className="text-white">{jobTitles.join(" · ")}</strong> in {locationLabel}
        </li>
        <li>
          <strong className="text-white">Boards:</strong> {sources || "none selected"}
        </li>
        <li>
          <strong className="text-white">Posted within:</strong> last{" "}
          {profile.preferences.maxPostedDays ?? 7} days
        </li>
      </ul>
    </div>
  );
}
