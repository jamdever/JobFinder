"use client";

import { api } from "@/lib/api";
import type { ApplyBrowserLoginPlatform, JobDto } from "@jobfinder/shared";
import { useCallback, useEffect, useState } from "react";

function loginPlatformForJob(job: JobDto): ApplyBrowserLoginPlatform | null {
  const url = job.url ?? "";
  if (/linkedin\.com\/jobs/i.test(url)) return "linkedin";
  if (/indeed\.com/i.test(url) || job.source === "indeed") return "indeed";
  return null;
}

export function ApplyToJobButton({ job }: { job: JobDto }) {
  const platform = loginPlatformForJob(job);
  const [opening, setOpening] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [hint, setHint] = useState("");
  const [loginReady, setLoginReady] = useState<boolean | null>(null);

  const refreshLogin = useCallback(async () => {
    if (!platform) {
      setLoginReady(true);
      return;
    }
    try {
      const s = await api.getApplyBrowserLoginStatus();
      setLoginReady(platform === "linkedin" ? s.linkedIn.ready : s.indeed.ready);
    } catch {
      setLoginReady(null);
    }
  }, [platform]);

  useEffect(() => {
    void refreshLogin();
  }, [refreshLogin]);

  useEffect(() => {
    const onFocus = () => void refreshLogin();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshLogin]);

  async function handleApply() {
    setOpening(true);
    setHint("Opening apply browser…");
    try {
      const res = await api.openJobInApplyBrowser(job.id);
      setHint(res.message);
      void refreshLogin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open job";
      setHint(msg);
      void refreshLogin();
    } finally {
      setOpening(false);
    }
  }

  async function handleSetupLogin() {
    if (!platform) return;
    setSetupLoading(true);
    setHint("");
    try {
      const res = await api.setupBrowserLogin(platform);
      setHint(res.message);
      setLoginReady(
        platform === "linkedin" ? res.login.linkedIn.ready : res.login.indeed.ready
      );
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not open login browser");
    } finally {
      setSetupLoading(false);
    }
  }

  const loginLabel = platform === "indeed" ? "Indeed" : "LinkedIn";
  const showLoginHint = platform != null && loginReady === false;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <button
        type="button"
        className="btn-primary text-center text-sm"
        disabled={opening || setupLoading}
        onClick={() => void handleApply()}
      >
        {opening ? "Opening browser…" : "Apply"}
      </button>
      {showLoginHint && (
        <>
          <p className="text-xs leading-snug text-amber-200/90">
            First time? Sign in in JobFinder&apos;s apply browser ({loginLabel}), not everyday
            Chrome.
          </p>
          <button
            type="button"
            className="btn-ghost text-center text-xs"
            disabled={setupLoading || opening}
            onClick={() => void handleSetupLogin()}
          >
            {setupLoading ? "Opening login…" : `Set up ${loginLabel} login`}
          </button>
        </>
      )}
      {hint && (
        <p
          className={`break-words text-center text-xs leading-snug ${
            /no .* login|wait for it|cannot reach|already open|could not open/i.test(hint)
              ? "text-amber-200/80"
              : "text-slate-500"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
