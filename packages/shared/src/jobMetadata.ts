import type { JobDto } from "./index.js";

export type WorkArrangement = "remote" | "hybrid" | "on-site" | "unknown";
export type EmploymentType =
  | "internship"
  | "graduate"
  | "full-time"
  | "part-time"
  | "contract"
  | "unknown";
export type VisaSponsorship = "yes" | "no" | "unknown";

/** LinkedIn job application style (Easy Apply vs company site). */
export type LinkedInApplyType = "easy_apply" | "external" | "unknown";

export interface JobMetadata {
  workArrangement: WorkArrangement;
  employmentType: EmploymentType;
  visaSponsorship: VisaSponsorship;
  techStack: string[];
  salaryMin?: number;
  salaryMax?: number;
  hasSalary: boolean;
}

const TECH_KEYWORDS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "c#",
  "csharp",
  ".net",
  "react",
  "node",
  "nodejs",
  "angular",
  "vue",
  "sql",
  "mongodb",
  "postgresql",
  "aws",
  "azure",
  "docker",
  "kubernetes",
  "linux",
  "git",
  "html",
  "css",
  "rest",
  "api",
  "graphql",
  "spring",
  "django",
  "flask",
  "fastapi",
  "terraform",
  "ansible",
  "jenkins",
  "ci/cd",
  "agile",
  "scrum",
  "playwright",
  "selenium",
];

function jobBlob(
  job: Pick<JobDto, "title" | "description" | "tags"> & {
    location?: string;
    salary?: string;
  }
): string {
  return [
    job.title,
    job.location ?? "",
    job.description,
    job.salary ?? "",
    ...(job.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

export function detectWorkArrangement(
  job: Pick<JobDto, "title" | "location" | "description" | "tags">
): WorkArrangement {
  const blob = jobBlob(job);

  const remote =
    /\b(remote|work from home|wfh|fully remote|100%\s*remote|telecommute|distributed)\b/.test(
      blob
    );
  const hybrid =
    /\b(hybrid|partially remote|flexible working|flexible work|mix of remote|days in office|days per week in office)\b/.test(
      blob
    );
  const onSite =
    /\b(on[- ]?site|on site|in[- ]?office|office[- ]?based|in person|in-person|onsite only)\b/.test(
      blob
    );

  if (hybrid || (remote && onSite)) return "hybrid";
  if (remote) return "remote";
  if (onSite) return "on-site";
  if (/\bremote\b/.test(job.location.toLowerCase())) return "remote";
  return "unknown";
}

export function detectEmploymentType(
  job: Pick<JobDto, "title" | "description" | "tags">
): EmploymentType {
  const blob = jobBlob(job);

  if (/\b(intern|internship|summer placement|co[- ]?op|work placement)\b/.test(blob)) {
    return "internship";
  }
  if (/\b(graduate|grad programme|grad program|graduate programme|new grad|entry level)\b/.test(blob)) {
    return "graduate";
  }
  if (/\b(part[- ]?time|parttime)\b/.test(blob)) {
    return "part-time";
  }
  if (/\b(contract|fixed[- ]?term|temporary|temp role|6[- ]?month contract)\b/.test(blob)) {
    return "contract";
  }
  if (/\b(full[- ]?time|permanent|fte)\b/.test(blob)) {
    return "full-time";
  }
  return "unknown";
}

export function detectVisaSponsorship(
  job: Pick<JobDto, "title" | "description" | "tags">
): VisaSponsorship {
  const blob = jobBlob(job);

  if (
    /\b(visa sponsorship|sponsor visa|visa support|work permit provided|relocation sponsorship|will sponsor)\b/.test(
      blob
    )
  ) {
    return "yes";
  }
  if (
    /\b(no sponsorship|without sponsorship|not provide sponsorship|must be eligible to work|right to work in (?:ireland|eu)|eu citizen|eea citizen)\b/.test(
      blob
    )
  ) {
    return "no";
  }
  return "unknown";
}

export function extractTechStack(
  job: Pick<JobDto, "title" | "description" | "tags" | "atsMatchedKeywords">
): string[] {
  const blob = jobBlob(job);
  const found = new Set<string>();

  for (const tech of TECH_KEYWORDS) {
    if (blob.includes(tech)) found.add(tech === "c#" ? "c#" : tech);
  }
  for (const tag of job.tags ?? []) {
    const t = tag.toLowerCase().trim();
    if (t.length >= 2) found.add(t);
  }
  for (const kw of job.atsMatchedKeywords ?? []) {
    const k = kw.toLowerCase().trim();
    if (TECH_KEYWORDS.some((t) => k.includes(t)) || k.length <= 20) found.add(k);
  }

  return [...found].slice(0, 24);
}

export function parseSalaryRange(
  job: Pick<JobDto, "salary" | "description">
): { salaryMin?: number; salaryMax?: number; hasSalary: boolean } {
  const text = `${job.salary ?? ""} ${job.description ?? ""}`.replace(/,/g, "");
  const hasSalary =
    !!job.salary?.trim() &&
    !/^not listed$/i.test(job.salary) &&
    /\d/.test(job.salary);

  const euro = text.match(
    /€\s*(\d{2,3}(?:\.\d+)?)\s*k?\s*(?:-|to|–)\s*€?\s*(\d{2,3}(?:\.\d+)?)\s*k?/i
  );
  if (euro) {
    const a = scaleSalary(Number(euro[1]), text.includes("k"));
    const b = scaleSalary(Number(euro[2]), true);
    return { salaryMin: Math.min(a, b), salaryMax: Math.max(a, b), hasSalary: true };
  }

  const range = text.match(/(\d{2,3}(?:\.\d+)?)\s*k\s*(?:-|to|–)\s*(\d{2,3}(?:\.\d+)?)\s*k/i);
  if (range) {
    const a = Number(range[1]) * 1000;
    const b = Number(range[2]) * 1000;
    return { salaryMin: Math.min(a, b), salaryMax: Math.max(a, b), hasSalary: true };
  }

  const single = text.match(/€\s*(\d{2,3}(?:\.\d+)?)\s*k?/i) ?? text.match(/(\d{2,3})\s*k\b/i);
  if (single) {
    const val = scaleSalary(Number(single[1]), /k/i.test(single[0]));
    return { salaryMin: val, salaryMax: val, hasSalary: true };
  }

  return { hasSalary };
}

function scaleSalary(n: number, forceK: boolean): number {
  if (forceK || n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

export function isLinkedInJob(job: Pick<JobDto, "source" | "url">): boolean {
  return /linkedin/i.test(job.source) || /linkedin\.com/i.test(job.url);
}

/** Heuristic from listing text when not stored at collect time. */
export function detectLinkedInApplyType(
  job: Pick<JobDto, "source" | "url" | "title" | "description" | "tags" | "location">
): LinkedInApplyType {
  if (!isLinkedInJob(job)) return "unknown";

  const blob = [job.title, job.description, job.location ?? "", ...(job.tags ?? [])]
    .join(" ")
    .toLowerCase();

  if (/\beasy apply\b/.test(blob)) return "easy_apply";
  if (
    /apply on company website|company website|external apply|offsite|you will be redirected/i.test(
      blob
    )
  ) {
    return "external";
  }
  return "unknown";
}

export function resolveLinkedInApplyType(
  job: Pick<
    JobDto,
    "source" | "url" | "title" | "description" | "tags" | "location" | "linkedInApplyType"
  >
): LinkedInApplyType | null {
  if (!isLinkedInJob(job)) return null;
  return job.linkedInApplyType ?? detectLinkedInApplyType(job);
}

export function deriveJobMetadata(job: JobDto): JobMetadata {
  const salary = parseSalaryRange(job);
  return {
    workArrangement: detectWorkArrangement(job),
    employmentType: detectEmploymentType(job),
    visaSponsorship: detectVisaSponsorship(job),
    techStack: extractTechStack(job),
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    hasSalary: salary.hasSalary,
  };
}

export type JobWithMetadata = JobDto & JobMetadata;

export function enrichJob(job: JobDto): JobWithMetadata {
  const meta = deriveJobMetadata(job);
  const linkedInApplyType = resolveLinkedInApplyType(job) ?? undefined;
  return {
    ...job,
    workArrangement: job.workArrangement ?? meta.workArrangement,
    employmentType: job.employmentType ?? meta.employmentType,
    visaSponsorship: job.visaSponsorship ?? meta.visaSponsorship,
    techStack: job.techStack?.length ? job.techStack : meta.techStack,
    salaryMin: job.salaryMin ?? meta.salaryMin,
    salaryMax: job.salaryMax ?? meta.salaryMax,
    hasSalary: job.hasSalary ?? meta.hasSalary,
    linkedInApplyType: job.linkedInApplyType ?? linkedInApplyType,
  };
}

export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  "on-site": "On-site",
  unknown: "Not specified",
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  internship: "Internship",
  graduate: "Graduate",
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Contract",
  unknown: "Unspecified",
};

export const LINKEDIN_APPLY_TYPE_LABELS: Record<LinkedInApplyType, string> = {
  easy_apply: "Easy Apply",
  external: "External apply",
  unknown: "Unknown",
};
