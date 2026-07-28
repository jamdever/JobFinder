"use client";

import { api } from "@/lib/api";
import { useState } from "react";

function cleanDescription(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MIN_DESC = 80;

export function JobDescriptionCollapsible({
  jobId,
  description,
  jobUrl,
}: {
  jobId: string;
  description?: string;
  jobUrl: string;
}) {
  const [text, setText] = useState(() => cleanDescription(description ?? ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasBody = text.length >= MIN_DESC;

  async function loadDescription() {
    if (text.length >= MIN_DESC || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.fetchJobDescription(jobId);
      const next = cleanDescription(res.description);
      if (next.length >= MIN_DESC) setText(next);
      else setError("Could not load a full description from the job board.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load description");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="group rounded-md border border-slate-800/80 bg-slate-950/30"
      onToggle={(e) => {
        if (e.currentTarget.open) void loadDescription();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-slate-300 [&::-webkit-details-marker]:hidden">
        <span>Job description</span>
        <span className="text-xs font-normal text-slate-500 group-open:hidden">Show</span>
        <span className="hidden text-xs font-normal text-slate-500 group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-slate-800/80 px-3 py-3">
        {loading ? (
          <p className="text-sm text-slate-500">Loading description from job board…</p>
        ) : hasBody ? (
          <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
            {text}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            {error || "No description saved yet."}{" "}
            <a
              href={jobUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              View full posting
            </a>
          </p>
        )}
      </div>
    </details>
  );
}
