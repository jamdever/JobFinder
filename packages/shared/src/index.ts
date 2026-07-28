export type JobStatus =
  | "discovered"
  | "queued"
  | "prepared"
  | "applied"
  | "skipped"
  | "failed"
  | "analyzed"
  | "saved"
  | "dismissed";

export type MatchRecommendation =
  | "strong_match"
  | "good_match"
  | "moderate_match"
  | "weak_match"
  | "not_recommended";

export interface PersonalInfo {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
}

export interface Preferences {
  titles: string[];
  keywords: string[];
  excludeKeywords: string[];
  locations: string[];
  /** Only keep jobs posted within this many days */
  maxPostedDays: number;
  minMatchScore: number;
  maxApplicationsPerDay: number;
}

export interface ApplicationSettings {
  coverLetterTone: string;
  defaultAnswerMaxWords: number;
  requireSubmitConfirmation: boolean;
  delayBetweenApplications: number;
  /** When true, API periodically collects LinkedIn jobs (Easy Apply tagged on scrape). */
  autoApplyWatchEnabled?: boolean;
  /** Minutes between LinkedIn Easy Apply scans (default 15). */
  autoApplyWatchIntervalMinutes?: number;
  /** After each scan, run Easy Apply pipeline on jobs one by one. */
  autoApplyWatchApplyEnabled?: boolean;
  /** When true, fill forms but do not click Submit (default true). */
  autoApplyWatchDryRun?: boolean;
  /** Max jobs to apply to per scan cycle (default 2). */
  autoApplyWatchMaxPerScan?: number;
  /** Indeed Easy Apply watch (separate from LinkedIn). */
  indeedAutoApplyWatchEnabled?: boolean;
  indeedAutoApplyWatchIntervalMinutes?: number;
  indeedAutoApplyWatchApplyEnabled?: boolean;
  indeedAutoApplyWatchDryRun?: boolean;
  indeedAutoApplyWatchMaxPerScan?: number;
  /** Shorter waits, fewer screenshots, skip redundant prep (default true). */
  autoApplyFastMode?: boolean;
  /** Set when LinkedIn session is saved in the automation browser profile. */
  linkedInBrowserLoginAt?: string;
  /** Set when Indeed session is saved in the same automation browser profile. */
  indeedBrowserLoginAt?: string;
  /** Set when Cloudflare / Indeed.ie access is saved in the apply browser (cf_clearance). */
  indeedCloudflareUnlockedAt?: string;
}

export interface LinkedInBrowserLoginStatusDto {
  ready: boolean;
  savedAt?: string;
}

export interface IndeedBrowserLoginStatusDto {
  ready: boolean;
  savedAt?: string;
  /** Cloudflare Turnstile cleared — apply browser can load Indeed without “Verify you are human”. */
  cloudflareReady: boolean;
  cloudflareUnlockedAt?: string;
}

export interface UnlockIndeedAccessResultDto {
  message: string;
  saved: boolean;
  cloudflareReady: boolean;
  cloudflareUnlockedAt?: string;
  capsolverConfigured: boolean;
}

export interface ApplyBrowserLoginStatusDto {
  linkedIn: LinkedInBrowserLoginStatusDto;
  indeed: IndeedBrowserLoginStatusDto;
}

export interface SearchSettings {
  sources: string[];
  /** Primary search country (default Ireland) */
  country: string;
  /** @deprecated use counties — kept for older profiles */
  county?: string;
  /** Irish counties to search — empty = all Ireland */
  counties?: string[];
}

export interface UserProfile {
  personal: PersonalInfo;
  resumePath: string;
  /** Set by API when CV file exists on disk */
  hasResume?: boolean;
  resumeFileName?: string;
  preferences: Preferences;
  application: ApplicationSettings;
  search: SearchSettings;
}

export interface JobListingInput {
  externalId: string;
  source: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  description?: string;
  tags?: string[];
  salary?: string;
  postedAt?: string;
  /** Set when collected from LinkedIn search cards */
  linkedInApplyType?: import("./jobMetadata.js").LinkedInApplyType;
}

export interface JobDto {
  id: string;
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  tags: string[];
  salary: string;
  /** Keyword pre-score 0–1 */
  matchScore: number;
  status: JobStatus;
  /** AI match score 0–100 */
  aiMatchScore?: number;
  /** OpenAI model used for aiMatchScore */
  aiAnalyzedModel?: string;
  matchSummary?: string;
  matchStrengths?: string[];
  matchGaps?: string[];
  matchRecommendation?: MatchRecommendation;
  analyzedAt?: string;
  /** AI-tailored CV for this role (markdown) */
  tailoredCvMarkdown?: string;
  tailoredCvChanges?: string[];
  tailoredCvAt?: string;
  tailoredCvModel?: string;
  tailorErrorMessage?: string;
  coverLetter?: string;
  coverLetterKeyPoints?: string[];
  coverLetterAt?: string;
  coverLetterModel?: string;
  coverLetterErrorMessage?: string;
  /** Overall ATS readiness 0–100 */
  atsScore?: number;
  /** Keyword overlap with job posting 0–100 */
  atsKeywordScore?: number;
  atsMatchedKeywords?: string[];
  atsMissingKeywords?: string[];
  atsFormatIssues?: string[];
  atsSuggestions?: string[];
  atsSummary?: string;
  atsAt?: string;
  atsModel?: string;
  atsErrorMessage?: string;
  screeningAnswers?: Record<string, string>;
  errorMessage?: string;
  discoveredAt: string;
  postedAt?: string;
  appliedAt?: string;
  /** Derived filters (stored or computed) */
  workArrangement?: import("./jobMetadata.js").WorkArrangement;
  employmentType?: import("./jobMetadata.js").EmploymentType;
  visaSponsorship?: import("./jobMetadata.js").VisaSponsorship;
  techStack?: string[];
  salaryMin?: number;
  salaryMax?: number;
  hasSalary?: boolean;
  /** LinkedIn: Easy Apply vs apply on company website */
  linkedInApplyType?: import("./jobMetadata.js").LinkedInApplyType;
}

export interface MatcherStats {
  total: number;
  collected: number;
  analyzed: number;
  strongMatches: number;
  goodMatches: number;
  pendingAnalysis: number;
  minAiScore?: number;
  aiProvider?: string;
  aiModel?: string;
}

export interface StoredCvVersion {
  id: string;
  text: string;
  keyChanges: string[];
  model?: string;
  createdAt: string;
}

export interface StoredCoverLetterVersion {
  id: string;
  text: string;
  keyPoints: string[];
  model?: string;
  createdAt: string;
}

export interface StoredOriginalCv {
  text: string;
  capturedAt: string;
  resumeFileName?: string;
}

export interface AppliedRecordDto {
  id: string;
  appliedAt: string;
  jobTitle: string;
  company: string;
  location: string;
  jobUrl: string;
  originalCvText: string;
  tailoredCvText?: string;
  coverLetterText?: string;
  tailoredCvVersionId?: string;
  coverLetterVersionId?: string;
  note?: string;
}

export interface ApplicationVersionsDto {
  jobId: string;
  originalCv?: StoredOriginalCv;
  cvVersions: StoredCvVersion[];
  coverLetterVersions: StoredCoverLetterVersion[];
  appliedRecords: AppliedRecordDto[];
  lastAppliedAt?: string;
}

export interface AppliedJobDto {
  id: string;
  jobId: string;
  appliedAt: string;
  jobTitle: string;
  company: string;
  location: string;
  jobUrl: string;
  hasTailoredCv: boolean;
  hasCoverLetter: boolean;
  note?: string;
}

export {
  buildPreferenceLocations,
  DEFAULT_SEARCH_COUNTRY,
  formatSearchLocationsLabel,
  getBoardSearchLocation,
  getSearchCounties,
  IRELAND_COUNTIES,
  jobLocationMatchesSearchCounties,
  normalizeCounty,
  type CountyMatchMode,
  type IrelandCounty,
} from "./locations.js";

export {
  deriveJobMetadata,
  detectWorkArrangement,
  enrichJob,
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  LINKEDIN_APPLY_TYPE_LABELS,
  detectLinkedInApplyType,
  isLinkedInJob,
  resolveLinkedInApplyType,
  type EmploymentType,
  type JobMetadata,
  type JobWithMetadata,
  type LinkedInApplyType,
  type VisaSponsorship,
  type WorkArrangement,
} from "./jobMetadata.js";

export type {
  ApplyAutomationResult,
  ApplyAutomationStep,
  LinkedInApplyMode,
} from "./applyAutomation.js";

export type {
  AutoApplyCandidateDto,
  AutoApplyCandidateStatus,
  AutoApplyLogDto,
  AutoApplyRunResult,
  AutoApplyRunStatus,
  AutoApplyStage,
  AutoApplyWatchStatusDto,
  IndeedAutoApplyCandidateDto,
  IndeedAutoApplyWatchStatusDto,
  ApplyBrowserLoginPlatform,
} from "./autoApply.js";
