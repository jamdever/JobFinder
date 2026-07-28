"use client";

import { FilteredJobList } from "@/components/FilteredJobList";
import { FindJobsProgressModal } from "@/components/FindJobsProgressModal";
import { OpenAiErrorAlert } from "@/components/OpenAiErrorAlert";
import { LinkedInLoginControl } from "@/components/LinkedInLoginControl";
import { SearchCriteriaBanner, SearchCriteriaSummary } from "@/components/SearchCriteriaBanner";
import { api } from "@/lib/api";
import { isSearchConfigured } from "@/lib/search";
import type { JobDto, UserProfile } from "@jobfinder/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-10 rounded-lg bg-slate-800/60" />
      <div className="h-24 rounded-lg bg-slate-800/60" />
      <div className="h-10 w-32 rounded-lg bg-slate-800/60" />
    </div>
  );
}

export function Dashboard() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [collectedJobs, setCollectedJobs] = useState<JobDto[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState("");
  const [apiError, setApiError] = useState(false);
  const [listKey, setListKey] = useState(0);
  const [findProgress, setFindProgress] = useState({
    percent: 0,
    message: "Starting job search…",
  });

  // Load profile once on mount.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setApiError(false);
      try {
        const p = await api.getProfile();
        if (!cancelled) setProfile(p);
      } catch {
        if (!cancelled) {
          setApiError(true);
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll collect progress while Find jobs is running.
  useEffect(() => {
    if (!finding) return;
    let cancelled = false;

    async function poll() {
      try {
        const p = await api.getCollectProgress();
        if (!cancelled && (p.active || p.percent > 0)) {
          setFindProgress({
            percent: p.percent,
            message: p.message || "Searching for jobs…",
          });
        }
      } catch {
        /* ignore poll errors while search runs */
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [finding]);

  const canCollect = profile ? isSearchConfigured(profile) : false;

  const jobsForList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return collectedJobs;
    return collectedJobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        (j.location ?? "").toLowerCase().includes(q)
    );
  }, [collectedJobs, searchQuery]);

  async function findJobs() {
    if (!canCollect) return;
    setFinding(true);
    setFindProgress({ percent: 2, message: "Starting job search…" });
    setMessage("");
    try {
      const res = await api.collectJobs();
      setFindProgress({ percent: 100, message: "Done" });

      if (res.jobs?.length) {
        setCollectedJobs(res.jobs);
      } else if (res.found === 0) {
        setCollectedJobs([]);
      } else {
        setCollectedJobs(await api.getRecentJobs(100));
      }

      setHasSearched(true);
      setListKey((k) => k + 1);

      const boardSummary = res.bySource?.length
        ? res.bySource.map((b) => `${b.source}: ${b.count}`).join(" · ")
        : "";
      const warnings = res.bySource
        ?.filter((b) => b.warning)
        .map((b) => `${b.source}: ${b.warning}`)
        .join(" ");

      if (res.found === 0) {
        setMessage(
          warnings || "No jobs found. Check board settings and API keys in .env."
        );
      } else {
        setMessage(
          `Found ${res.found} role(s) (${boardSummary}).${warnings ? ` ${warnings}` : ""}`
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Search failed");
    } finally {
      setFinding(false);
    }
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      {apiError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-200"
        >
          <p className="font-medium">Cannot reach the API</p>
          <p className="mt-1 text-red-200/80">
            Run <code className="rounded bg-red-950/50 px-1 text-red-100">npm run dev</code> from
            the project root (port 4000).
          </p>
        </div>
      )}

      <header>
        <h1 className="page-title">Dashboard</h1>
      </header>

      {profile &&
        (isSearchConfigured(profile) ? (
          <SearchCriteriaSummary profile={profile} />
        ) : (
          <div className="card-flat text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Active search
            </p>
            <p className="mt-1 text-slate-400">Not configured yet</p>
            <Link href="/settings" className="btn-ghost mt-3 inline-block text-sm">
              Edit
            </Link>
          </div>
        ))}

      <label className="block">
        <span className="sr-only">Filter jobs</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by title, company, or location…"
          disabled={!hasSearched || collectedJobs.length === 0}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      <SearchCriteriaBanner profile={profile} />

      <div className="flex flex-wrap items-center gap-2">
        {canCollect ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={finding}
              onClick={() => void findJobs()}
            >
              {finding ? "Searching…" : "Find jobs"}
            </button>
          </>
        ) : (
          <Link href="/settings" className="btn-primary">
            Configure search
          </Link>
        )}
      </div>

      <FindJobsProgressModal
        open={finding}
        percent={findProgress.percent}
        message={findProgress.message}
      />

      {message &&
        (message.includes("quota") || message.includes("429") || message.includes("billing") ? (
          <OpenAiErrorAlert message={message} />
        ) : (
          <p className="text-sm leading-relaxed text-slate-400">{message}</p>
        ))}

      <section className="space-y-4">
        <LinkedInLoginControl compact />
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <h2 className="text-base font-semibold text-slate-100">Jobs</h2>
        </div>

        {!hasSearched ? (
          <div className="card-flat py-12 text-center text-sm text-slate-500">
            <p className="font-medium text-slate-300">No jobs yet</p>
            <p className="mt-2">
              {canCollect
                ? "Click Find jobs to search job boards using your active search above."
                : "Configure titles and boards in Settings, then click Find jobs."}
            </p>
          </div>
        ) : collectedJobs.length === 0 ? (
          <div className="card-flat py-12 text-center text-sm text-slate-500">
            <p>No listings matched your search this run.</p>
            <p className="mt-2">
              Try{" "}
              <Link href="/settings" className="text-blue-400 hover:underline">
                widening titles or location
              </Link>
              , then run Find jobs again.
            </p>
          </div>
        ) : (
          <FilteredJobList
            key={listKey}
            initialJobs={jobsForList}
            emptyMessage={
              searchQuery.trim() ? "No jobs match your filter text." : "No jobs to show."
            }
          />
        )}
      </section>
    </div>
  );
}
