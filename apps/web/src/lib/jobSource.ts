const SOURCE_LABELS: Record<string, string> = {
  indeed: "Indeed",
  linkedin: "LinkedIn",
  jobsie: "Jobs.ie",
  remotive: "Remotive",
  remoteok: "Remote OK",
};

export function formatJobSource(source: string | undefined, url?: string): string {
  const key = source?.trim().toLowerCase();
  if (key && SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  if (key) return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const u = url?.toLowerCase() ?? "";
  if (u.includes("linkedin.com")) return "LinkedIn";
  if (u.includes("indeed.")) return "Indeed";
  if (u.includes("jobs.ie")) return "Jobs.ie";

  return source?.trim() || "Other";
}

export function jobSourceBadgeClass(source: string | undefined, url?: string): string {
  const key = (source?.trim().toLowerCase() || inferSourceKey(url)) ?? "";
  switch (key) {
    case "linkedin":
      return "border-blue-800/50 bg-blue-950/40 text-blue-200";
    case "indeed":
      return "border-indigo-800/50 bg-indigo-950/40 text-indigo-200";
    case "jobsie":
      return "border-teal-800/50 bg-teal-950/40 text-teal-200";
    default:
      return "border-ink-700 bg-ink-900 text-gray-400";
  }
}

function inferSourceKey(url?: string): string | undefined {
  const u = url?.toLowerCase() ?? "";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("indeed.")) return "indeed";
  if (u.includes("jobs.ie")) return "jobsie";
  return undefined;
}
