import type {
  AppliedJobDto,
  AutoApplyCandidateDto,
  AutoApplyLogDto,
  AutoApplyRunResult,
  ApplyBrowserLoginStatusDto,
  AutoApplyWatchStatusDto,
  IndeedAutoApplyCandidateDto,
  IndeedAutoApplyWatchStatusDto,
  ApplyBrowserLoginPlatform,
  JobDto,
  UnlockIndeedAccessResultDto,
  UserProfile,
} from "@jobfinder/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Cannot reach the API at ${API_URL}. Start the app with "npm run dev" from the JobFinder folder.`
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  getProfile: () => fetchApi<UserProfile>("/api/profile"),
  updateProfile: (body: Partial<UserProfile>) => {
    const { hasResume: _h, resumeFileName: _f, ...payload } = body;
    return fetchApi<UserProfile>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  collectJobs: () =>
    fetchApi<{
      message: string;
      found: number;
      eligible: number;
      removed?: number;
      duplicatesRemoved?: number;
      bySource?: { source: string; count: number; warning?: string }[];
      jobs?: JobDto[];
    }>("/api/matcher/collect/sync", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getCollectProgress: () =>
    fetchApi<{
      active: boolean;
      percent: number;
      stage: string;
      message: string;
      updatedAt: number;
    }>("/api/matcher/collect/progress"),
  fetchJobDescription: (jobId: string) =>
    fetchApi<{ description: string }>(`/api/jobs/${jobId}/description`, {
      method: "POST",
    }),
  getRecentJobs: (limit = 15) => fetchApi<JobDto[]>(`/api/jobs?limit=${limit}`),
  listAppliedJobs: (limit = 50) =>
    fetchApi<AppliedJobDto[]>(`/api/applications?limit=${limit}`),
  getApplyBrowserLoginStatus: () =>
    fetchApi<ApplyBrowserLoginStatusDto>("/api/autoapply/browser-login"),
  /** Opens the posting in JobFinder’s apply browser (saved LinkedIn session for LinkedIn jobs). */
  openJobInApplyBrowser: (jobId: string) =>
    fetchApi<{ message: string; url: string; jobId?: string }>(
      `/api/autoapply/open-job/${jobId}`,
      { method: "POST" }
    ),
  openLinkedInJobInBrowser: (jobId: string) =>
    fetchApi<{ message: string; url: string }>(`/api/autoapply/open-job/${jobId}`, {
      method: "POST",
    }),
  setupBrowserLogin: (platform: ApplyBrowserLoginPlatform = "both") =>
    fetchApi<{
      message: string;
      profileDir: string;
      login: ApplyBrowserLoginStatusDto;
    }>("/api/matcher/browser-login", {
      method: "POST",
      body: JSON.stringify({ platform }),
    }),
  getAutoApplyWatch: () => fetchApi<AutoApplyWatchStatusDto>("/api/autoapply/watch"),
  setAutoApplyWatch: (options: {
    enabled?: boolean;
    applyEnabled?: boolean;
    dryRun?: boolean;
    maxPerScan?: number;
    intervalMinutes?: number;
  }) =>
    fetchApi<AutoApplyWatchStatusDto>("/api/autoapply/watch", {
      method: "PATCH",
      body: JSON.stringify(options),
    }),
  scanLinkedInEasyApply: () =>
    fetchApi<{
      message: string;
      found: number;
      eligible: number;
      easyApplyInDb: number;
    }>("/api/autoapply/scan", { method: "POST" }),
  getAutoApplyCandidates: (limit = 30, minAiScore?: number) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (minAiScore != null) q.set("minAiScore", String(minAiScore));
    return fetchApi<AutoApplyCandidateDto[]>(`/api/autoapply/candidates?${q}`);
  },
  getAutoApplyLogs: (limit = 30) =>
    fetchApi<AutoApplyLogDto[]>(`/api/autoapply/logs?limit=${limit}`),
  runAutoApply: (
    jobId: string,
    options?: {
      dryRun?: boolean;
      headless?: boolean;
      skipAnalyze?: boolean;
      skipTailor?: boolean;
    }
  ) =>
    fetchApi<{ message: string; result: AutoApplyRunResult }>(
      `/api/autoapply/run/${jobId}`,
      {
        method: "POST",
        body: JSON.stringify({
          dryRun: options?.dryRun !== false,
          headless: options?.headless === true,
          skipAnalyze: options?.skipAnalyze === true,
          skipTailor: options?.skipTailor === true,
        }),
      }
    ),

  getIndeedUnlockStatus: () =>
    fetchApi<{
      cloudflareReady: boolean;
      cloudflareUnlockedAt?: string;
      capsolverConfigured: boolean;
    }>("/api/autoapply-indeed/unlock-indeed/status"),

  unlockIndeedAccess: () =>
    fetchApi<UnlockIndeedAccessResultDto>("/api/autoapply-indeed/unlock-indeed", {
      method: "POST",
    }),
  getIndeedAutoApplyWatch: () =>
    fetchApi<IndeedAutoApplyWatchStatusDto>("/api/autoapply-indeed/watch"),
  setIndeedAutoApplyWatch: (options: {
    enabled?: boolean;
    applyEnabled?: boolean;
    dryRun?: boolean;
    maxPerScan?: number;
    intervalMinutes?: number;
  }) =>
    fetchApi<IndeedAutoApplyWatchStatusDto>("/api/autoapply-indeed/watch", {
      method: "PATCH",
      body: JSON.stringify(options),
    }),
  scanIndeedEasyApply: () =>
    fetchApi<{
      message: string;
      found: number;
      eligible: number;
      easyApplyInDb: number;
    }>("/api/autoapply-indeed/scan", { method: "POST" }),
  getIndeedAutoApplyCandidates: (limit = 30, minAiScore?: number) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (minAiScore != null) q.set("minAiScore", String(minAiScore));
    return fetchApi<IndeedAutoApplyCandidateDto[]>(
      `/api/autoapply-indeed/candidates?${q}`
    );
  },
  getIndeedAutoApplyLogs: (limit = 30) =>
    fetchApi<AutoApplyLogDto[]>(`/api/autoapply-indeed/logs?limit=${limit}`),
  openIndeedJobInBrowser: (jobId: string) =>
    fetchApi<{ message: string; url: string }>(`/api/autoapply-indeed/open-job/${jobId}`, {
      method: "POST",
    }),
  runIndeedAutoApply: (
    jobId: string,
    options?: {
      dryRun?: boolean;
      headless?: boolean;
      skipAnalyze?: boolean;
      skipTailor?: boolean;
      forceRetry?: boolean;
    }
  ) =>
    fetchApi<{ message: string; result: AutoApplyRunResult }>(
      `/api/autoapply-indeed/run/${jobId}`,
      {
        method: "POST",
        body: JSON.stringify({
          dryRun: options?.dryRun !== false,
          headless: options?.headless === true,
          skipAnalyze: options?.skipAnalyze === true,
          skipTailor: options?.skipTailor === true,
          forceRetry: options?.forceRetry === true,
        }),
      }
    ),
};
