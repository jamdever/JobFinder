"use client";

import { IndeedCloudflareUnlock } from "@/components/IndeedCloudflareUnlock";
import { LinkedInLoginControl } from "@/components/LinkedInLoginControl";
import { OpenAiErrorAlert } from "@/components/OpenAiErrorAlert";
import { api } from "@/lib/api";
import type {
  AutoApplyLogDto,
  IndeedAutoApplyCandidateDto,
  IndeedAutoApplyWatchStatusDto,
} from "@jobfinder/shared";
import { useCallback, useEffect, useState } from "react";

export function AutoApplyIndeedPage() {
  const [candidates, setCandidates] = useState<IndeedAutoApplyCandidateDto[]>([]);
  const [logs, setLogs] = useState<AutoApplyLogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [dryRun, setDryRun] = useState(true);
  const [watch, setWatch] = useState<IndeedAutoApplyWatchStatusDto | null>(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewHint, setViewHint] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, l] = await Promise.all([
        api.getIndeedAutoApplyCandidates(30, 0),
        api.getIndeedAutoApplyLogs(20),
      ]);
      setCandidates(c);
      setLogs(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshWatch = useCallback(async () => {
    try {
      const status = await api.getIndeedAutoApplyWatch();
      setWatch(status);
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    void refreshWatch();
  }, [refreshWatch]);

  useEffect(() => {
    if (!watch?.enabled && !watch?.applying) return;
    const id = setInterval(() => {
      void refreshWatch();
      void load();
    }, 4000);
    return () => clearInterval(id);
  }, [watch?.enabled, watch?.applying, refreshWatch, load]);

  async function setAutoApplyOn(enabled: boolean) {
    setWatchLoading(true);
    setError("");
    try {
      const status = await api.setIndeedAutoApplyWatch({
        enabled,
        applyEnabled: enabled,
        intervalMinutes: watch?.intervalMinutes ?? 15,
      });
      setWatch(status);
      if (enabled) await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update Auto Apply Indeed");
    } finally {
      setWatchLoading(false);
    }
  }

  async function scanEasyApplyNow() {
    setScanning(true);
    setError("");
    setScanMessage("");
    try {
      const res = await api.scanIndeedEasyApply();
      setScanMessage(res.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Indeed Easy Apply scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function viewJob(jobId: string) {
    setViewingId(jobId);
    setViewHint("");
    setError("");
    try {
      const res = await api.openIndeedJobInBrowser(jobId);
      setViewHint(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open job in browser");
    } finally {
      setViewingId(null);
    }
  }

  async function runJob(jobId: string) {
    setRunningId(jobId);
    setError("");
    setViewHint("");
    try {
      const res = await api.runIndeedAutoApply(jobId, {
        dryRun,
        headless: false,
        forceRetry: true,
      });
      if (res.result.status === "success") {
        setViewHint(res.result.message || res.message);
      } else if (res.result.status === "skipped") {
        setViewHint(res.result.message || res.message);
      } else if (res.result.status === "failed") {
        setError(res.result.message || res.message);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto Apply Indeed failed");
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-amber-400">
          Indeed only
        </p>
        <h1 className="page-title mt-1">Auto Apply Indeed</h1>
      </header>

      <section className="card space-y-4 border-amber-900/30">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-slate-100">Auto Apply Indeed</p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-3">
            <span className="text-sm text-slate-400">
              {watchLoading ? "Updating..." : watch?.enabled ? "On" : "Off"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={watch?.enabled ?? false}
              disabled={watchLoading}
              onClick={() => setAutoApplyOn(!watch?.enabled)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                watch?.enabled ? "bg-amber-600" : "bg-slate-700"
              } ${watchLoading ? "opacity-60" : ""}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  watch?.enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
        </div>
        {watch?.enabled && (
          <div className="rounded-md border border-slate-800/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
            {watch.applying ? (
              <span className="text-amber-300">
                Applying {watch.applyCurrent ?? 0}/{watch.applyTotal ?? "?"}:{" "}
                {watch.applyJobTitle ?? "..."}
              </span>
            ) : watch.scanning ? (
              <span className="text-amber-300">Scanning Indeed now...</span>
            ) : (
              <>
                {watch.lastMessage ?? "Starting first scan..."}
                {watch.lastScanAt && (
                  <span className="mt-1 block text-xs text-slate-500">
                    Last cycle {new Date(watch.lastScanAt).toLocaleString()} - every{" "}
                    {watch.intervalMinutes} min
                  </span>
                )}
              </>
            )}
            {watch.lastError && (
              <p className="mt-1 text-amber-300/90">{watch.lastError}</p>
            )}
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <p className="section-title">Manual controls</p>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="rounded border-slate-600"
          />
          Dry run (fill + upload, no submit)
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={scanEasyApplyNow}
            disabled={scanning}
          >
            {scanning ? "Scanning Indeed..." : "Scan Easy Apply now"}
          </button>
          <button type="button" className="btn-ghost text-sm" onClick={load} disabled={loading}>
            Refresh list
          </button>
        </div>
        <LinkedInLoginControl platform="indeed" />
        <IndeedCloudflareUnlock disabled={runningId != null} />
        {viewHint && <p className="text-sm text-emerald-400/90">{viewHint}</p>}
        {scanMessage && <p className="text-sm text-emerald-400/90">{scanMessage}</p>}
      </section>

      {error && (
        <OpenAiErrorAlert
          message={
            error.includes("playwright") || error.includes("Executable")
              ? `${error} - Run: npm run playwright:install -w @jobfinder/api`
              : error
          }
        />
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h2 className="text-base font-semibold text-slate-100">Indeed Easy Apply candidates</h2>
          <span className="text-sm text-slate-500">
            {candidates.filter((j) => j.applicationStatus !== "applied").length} to apply -{" "}
            {candidates.filter((j) => j.applicationStatus === "applied").length} applied
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : candidates.length === 0 ? (
          <div className="card-flat py-8 text-center text-sm text-slate-500">
            <p>No Indeed Easy Apply jobs yet.</p>
            <p className="mt-2">
              Turn on <strong className="text-slate-400">Auto Apply Indeed</strong> above, or use{" "}
              <strong className="text-slate-400">Scan Indeed Easy Apply now</strong> for a one-off search.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {candidates.map((job) => {
              const isApplied = job.applicationStatus === "applied";
              return (
              <li
                key={job.id}
                className={`card-flat flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                  isApplied ? "border-emerald-900/40 bg-emerald-950/10" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-100">{job.title}</p>
                  <p className="text-sm text-slate-500">
                    {job.company}
                    {job.location ? ` - ${job.location}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {job.aiMatchScore != null ? `AI ${job.aiMatchScore}` : "Not analyzed"}
                    {job.hasTailoredCv ? " - CV ready" : " - needs tailor"}
                    <span className="ml-2 rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-400">
                      Indeed Easy Apply
                    </span>
                    {isApplied && (
                      <span className="ml-2 rounded bg-emerald-800/50 px-1.5 py-0.5 font-medium text-emerald-300">
                        Applied
                      </span>
                    )}
                  </p>
                  {isApplied && job.appliedMessage && (
                    <p className="mt-1 text-xs text-emerald-400/90">{job.appliedMessage}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    disabled={viewingId != null}
                    onClick={() => viewJob(job.id)}
                    title="Opens in the apply browser with your saved Indeed login"
                  >
                    {viewingId === job.id ? "Opening..." : "View"}
                  </button>
                  {isApplied ? (
                    <span className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-3 py-1.5 text-sm font-medium text-emerald-300">
                      Applied
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      disabled={runningId != null}
                      onClick={() => runJob(job.id)}
                    >
                      {runningId === job.id
                        ? "Running..."
                        : dryRun
                          ? "Dry run"
                          : "Apply"}
                    </button>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-slate-100 border-b border-slate-800/80 pb-3">
          Application log
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500">No Auto Apply Indeed runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => {
              const retryable = isIndeedRetryableSkippedLog(log);
              return (
              <li key={log.id} className="card-flat text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-200">
                    {log.jobTitle} - {log.company}
                  </span>
                  <StatusBadge status={log.status} dryRun={log.dryRun} />
                </div>
                <p className="mt-1 text-slate-500">{log.message}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {log.stage} - {log.dryRun ? "dry run" : log.submitted ? "submitted" : "no submit"} -{" "}
                  {new Date(log.createdAt).toLocaleString()}
                </p>
                {retryable && (
                  <button
                    type="button"
                    className="btn-primary mt-3 text-sm"
                    disabled={runningId != null}
                    onClick={() => runJob(log.jobId)}
                  >
                    {runningId === log.jobId
                      ? "Running..."
                      : log.dryRun
                        ? "Retry dry run"
                        : "Retry apply"}
                  </button>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function isIndeedRetryableSkippedLog(log: AutoApplyLogDto): boolean {
  const display =
    log.dryRun && log.status === "failed" ? "skipped" : log.status;
  if (display !== "skipped") return false;
  const m = log.message.toLowerCase();
  return !/already complete|already applied|no dry run needed/.test(m);
}

function StatusBadge({
  status,
  dryRun,
}: {
  status: AutoApplyLogDto["status"];
  dryRun?: boolean;
}) {
  const display: AutoApplyLogDto["status"] =
    dryRun && status === "failed" ? "skipped" : status;
  const styles: Record<AutoApplyLogDto["status"], string> = {
    success: "bg-emerald-950/50 text-emerald-400",
    failed: "bg-red-950/50 text-red-300",
    running: "bg-amber-950/50 text-amber-300",
    pending: "bg-slate-800 text-slate-400",
    skipped: "bg-amber-950/50 text-amber-300",
  };
  return (
    <span className={`badge ${styles[display]}`}>{display}</span>
  );
}

