"use client";

import { createPortal } from "react-dom";

type FindJobsProgressModalProps = {
  open: boolean;
  percent: number;
  message: string;
};

/** Full-screen progress overlay shown while Find jobs is running. */
export function FindJobsProgressModal({ open, percent, message }: FindJobsProgressModalProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="find-jobs-loading-title"
      aria-describedby="find-jobs-loading-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-700/80 bg-slate-900 px-6 py-7 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p id="find-jobs-loading-title" className="text-lg font-semibold text-slate-100">
              Searching for jobs
            </p>
            <p
              id="find-jobs-loading-desc"
              className="mt-1.5 text-sm text-slate-400"
              aria-live="polite"
            >
              {message}
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-blue-400">
            {percent}%
          </span>
        </div>
        <div
          className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Job search progress"
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(percent, 3)}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Keep this tab open — LinkedIn and Indeed searches can take a few minutes.
        </p>
      </div>
    </div>,
    document.body
  );
}
