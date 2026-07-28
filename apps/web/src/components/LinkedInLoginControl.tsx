"use client";

import { api } from "@/lib/api";
import type { ApplyBrowserLoginPlatform, ApplyBrowserLoginStatusDto } from "@jobfinder/shared";
import { useCallback, useEffect, useRef, useState } from "react";

function LoginBadge({
  label,
  ready,
  savedAt,
}: {
  label: string;
  ready: boolean;
  savedAt?: string;
}) {
  if (!ready) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-1.5 text-sm text-amber-200">
        <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
        {label} — not signed in
      </span>
    );
  }
  const savedLabel = savedAt
    ? `Saved ${new Date(savedAt).toLocaleDateString()}`
    : "Saved in apply browser";
  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border border-emerald-900/50 bg-emerald-950/40 px-3 py-1.5 text-sm font-medium text-emerald-300"
      title={savedLabel}
    >
      <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
      {label} — Done
    </span>
  );
}

const PLATFORM_LABEL: Record<ApplyBrowserLoginPlatform, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  both: "LinkedIn & Indeed",
};

export function LinkedInLoginControl({
  compact,
  platform = "both",
}: {
  compact?: boolean;
  /** Which site this page needs — only that login is shown and opened. */
  platform?: ApplyBrowserLoginPlatform;
}) {
  const [status, setStatus] = useState<ApplyBrowserLoginStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [hint, setHint] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const label = PLATFORM_LABEL[platform];

  const isReady = useCallback(
    (s: ApplyBrowserLoginStatusDto | null) => {
      if (!s) return false;
      if (platform === "linkedin") return s.linkedIn.ready;
      if (platform === "indeed") return s.indeed.ready;
      return s.linkedIn.ready && s.indeed.ready;
    },
    [platform]
  );

  const refresh = useCallback(async () => {
    try {
      const s = await api.getApplyBrowserLoginStatus();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(() => {
      attempts++;
      void refresh().then((s) => {
        if (isReady(s)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setHint(
            platform === "both"
              ? "Indeed and LinkedIn login saved. You're all set."
              : `${label} login saved. You're all set.`
          );
        }
      });
      if (attempts >= 60 && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 5000);
  }

  async function setupLogin() {
    setOpening(true);
    setHint("");
    try {
      const res = await api.setupBrowserLogin(platform);
      setStatus(res.login);
      if (isReady(res.login)) {
        setHint(`${label} login is already saved.`);
      } else {
        setHint(
          platform === "both"
            ? "Sign in on both tabs in the browser window that opened — not your normal Chrome/Edge."
            : `Sign in to ${label} in the browser window that opened — not your normal Chrome/Edge. Status updates when your session is saved.`
        );
        startPolling();
      }
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not open browser");
    } finally {
      setOpening(false);
    }
  }

  if (loading) {
    return (
      <span className="text-sm text-slate-500">
        Checking {platform === "both" ? "apply browser" : label} login…
      </span>
    );
  }

  const wrapClass = compact ? "flex flex-wrap items-center gap-2" : "space-y-2";
  const setupButtonLabel =
    platform === "both"
      ? "Set up apply browser login"
      : platform === "linkedin"
        ? "Set up LinkedIn login"
        : "Set up Indeed login";

  if (isReady(status) && status) {
    return (
      <div className={wrapClass}>
        {platform !== "indeed" && (
          <LoginBadge label="LinkedIn" ready={status.linkedIn.ready} savedAt={status.linkedIn.savedAt} />
        )}
        {platform !== "linkedin" && (
          <LoginBadge label="Indeed" ready={status.indeed.ready} savedAt={status.indeed.savedAt} />
        )}
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={setupLogin}
          disabled={opening}
        >
          {opening ? "Opening…" : "Sign in again"}
        </button>
        {hint && <p className="w-full text-sm text-emerald-400/90">{hint}</p>}
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      {status && platform !== "indeed" && (
        <LoginBadge
          label="LinkedIn"
          ready={status.linkedIn.ready}
          savedAt={status.linkedIn.savedAt}
        />
      )}
      {status && platform !== "linkedin" && (
        <LoginBadge label="Indeed" ready={status.indeed.ready} savedAt={status.indeed.savedAt} />
      )}
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={setupLogin}
        disabled={opening}
      >
        {opening ? "Opening browser…" : setupButtonLabel}
      </button>
      {!compact && (
        <p className="w-full text-xs text-slate-500">
          {platform === "both"
            ? "Opens Indeed and LinkedIn in JobFinder's apply browser."
            : `Opens ${label} login only in JobFinder's apply browser.`}
        </p>
      )}
      {hint && <p className="w-full text-sm text-slate-400">{hint}</p>}
    </div>
  );
}
