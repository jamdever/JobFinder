"use client";

import { api } from "@/lib/api";
import type { ApplyBrowserLoginStatusDto, UnlockIndeedAccessResultDto } from "@jobfinder/shared";
import { useCallback, useEffect, useState } from "react";

function formatSavedAt(iso?: string): string {
  if (!iso) return "Saved in apply browser";
  return `Saved ${new Date(iso).toLocaleString()}`;
}

export function IndeedCloudflareUnlock({ disabled }: { disabled?: boolean }) {
  const [loginStatus, setLoginStatus] = useState<ApplyBrowserLoginStatusDto | null>(null);
  const [capsolverConfigured, setCapsolverConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [hint, setHint] = useState("");

  const cloudflareReady = loginStatus?.indeed.cloudflareReady ?? false;
  const cloudflareUnlockedAt = loginStatus?.indeed.cloudflareUnlockedAt;

  const refresh = useCallback(async () => {
    try {
      const [login, unlock] = await Promise.all([
        api.getApplyBrowserLoginStatus(),
        api.getIndeedUnlockStatus(),
      ]);
      setLoginStatus(login);
      setCapsolverConfigured(unlock.capsolverConfigured);
      if (unlock.cloudflareReady && !login.indeed.cloudflareReady) {
        setLoginStatus({
          ...login,
          indeed: {
            ...login.indeed,
            cloudflareReady: true,
            cloudflareUnlockedAt: unlock.cloudflareUnlockedAt,
          },
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  async function unlock() {
    setUnlocking(true);
    setHint("");
    try {
      const result: UnlockIndeedAccessResultDto = await api.unlockIndeedAccess();
      await refresh();
      if (result.saved && result.cloudflareReady) {
        setHint(result.message);
      } else {
        setHint(result.message || "Unlock finished but access was not saved — try again.");
      }
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Checking Cloudflare access…</p>;
  }

  if (cloudflareReady) {
    return (
      <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/25 p-3 space-y-2">
        <p
          className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300"
          title={formatSavedAt(cloudflareUnlockedAt)}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
          Cloudflare access saved
        </p>
        <p className="text-xs text-slate-400">
          Indeed.ie loads in the apply browser without the human check. Run again only if
          Cloudflare blocks you again.
        </p>
        <button
          type="button"
          className="btn-ghost text-sm"
          disabled={disabled || unlocking}
          onClick={() => void unlock()}
        >
          {unlocking ? "Refreshing access…" : "Refresh Cloudflare access"}
        </button>
        {hint && <p className="text-sm text-emerald-400/90">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 space-y-2">
      <p className="text-sm text-amber-100/90">
        Stuck on Cloudflare “Verify you are human”? Press once — access is saved in the apply
        browser
        {capsolverConfigured ? " (CapSolver from .env will solve it automatically)" : ""}.
        {!capsolverConfigured &&
          " Complete the checkbox in the browser window that opens if you see it."}
      </p>
      <button
        type="button"
        className="btn-primary text-sm"
        disabled={disabled || unlocking}
        onClick={() => void unlock()}
      >
        {unlocking ? "Unlocking Indeed…" : "Unlock Indeed access"}
      </button>
      {hint && (
        <p
          className={`text-sm ${hint.includes("saved") || hint.includes("Saved") ? "text-emerald-400/90" : "text-slate-400"}`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
