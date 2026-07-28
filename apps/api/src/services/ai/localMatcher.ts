import type { MatchRecommendation, UserProfile } from "@jobfinder/shared";
import { bestTitleRelevance } from "../matching.js";
import { getSearchTitles } from "../search/utils.js";
import type { JobMatchAnalysis } from "./types.js";

const STOP = new Set([
  "the", "and", "for", "with", "you", "our", "are", "will", "this", "that", "from",
  "have", "has", "was", "were", "been", "being", "your", "all", "any", "can", "may",
  "not", "but", "job", "role", "team", "work", "year", "years", "experience", "required",
  "preferred", "ability", "including", "within", "using", "used", "etc", "ireland", "dublin",
]);

const SKILL_HINTS = [
  "javascript", "typescript", "python", "java", "react", "node", "nodejs", "sql", "mongodb",
  "postgresql", "aws", "azure", "docker", "kubernetes", "git", "html", "css", "api", "rest",
  "graphql", "csharp", "dotnet", ".net", "spring", "angular", "vue", "linux", "agile", "scrum",
  "software", "developer", "engineer", "graduate", "junior", "intern",
];

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return new Set(words);
}

function overlapTokens(a: Set<string>, b: Set<string>): string[] {
  const hits: string[] = [];
  for (const w of a) {
    if (b.has(w)) hits.push(w);
  }
  return hits.sort((x, y) => y.length - x.length);
}

function scoreToRecommendation(score: number): MatchRecommendation {
  if (score >= 85) return "strong_match";
  if (score >= 70) return "good_match";
  if (score >= 55) return "moderate_match";
  if (score >= 40) return "weak_match";
  return "not_recommended";
}

export function analyzeJobLocally(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  tags: string[];
  profile: UserProfile;
  resumeText: string;
}): JobMatchAnalysis {
  const { title, company, location, description, tags, profile, resumeText } = params;

  const jobBlob = [title, company, location, description, ...tags].join(" ");
  const resumeTokens = tokenize(resumeText);
  const jobTokens = tokenize(jobBlob);
  const descTokens = tokenize(description);

  const matched = overlapTokens(resumeTokens, jobTokens);
  const descMatched = overlapTokens(resumeTokens, descTokens);
  const overlapRatio =
    resumeTokens.size > 0 ? matched.length / Math.min(resumeTokens.size, 120) : 0;
  const descOverlapRatio =
    descTokens.size > 0 ? descMatched.length / Math.min(descTokens.size, 80) : 0;

  const titleScore = profile.preferences.titles.length
    ? bestTitleRelevance(profile, title)
    : 0.55;

  const prefKeywordHits = profile.preferences.keywords.filter((k) =>
    jobBlob.toLowerCase().includes(k.toLowerCase())
  );
  const skillHits = SKILL_HINTS.filter(
    (s) => resumeTokens.has(s) && jobTokens.has(s)
  );
  const jobOnlySkills = SKILL_HINTS.filter(
    (s) => jobTokens.has(s) && !resumeTokens.has(s)
  );

  const titlePart = titleScore * 36;
  const overlapPart = overlapRatio * 22 + descOverlapRatio * 12;
  const prefPart = Math.min(10, prefKeywordHits.length * 2.5);
  const skillPart = Math.min(12, skillHits.length * 2);
  const skillPenalty = Math.min(28, jobOnlySkills.length * 6);
  const titlePenalty = titleScore < 0.45 ? 18 : titleScore < 0.6 ? 8 : 0;
  const thinDescPenalty = description.trim().length < 120 ? 6 : 0;

  let score = Math.round(
    titlePart + overlapPart + prefPart + skillPart - skillPenalty - titlePenalty - thinDescPenalty
  );
  score = Math.min(96, Math.max(22, score));

  const strengths: string[] = [];
  if (titleScore >= 0.7) {
    const targets = getSearchTitles(profile).join(", ");
    strengths.push(`Job title aligns with your target role${targets ? ` (${targets})` : ""}.`);
  }
  if (skillHits.length) {
    strengths.push(`Shared skills: ${skillHits.slice(0, 5).join(", ")}.`);
  }
  if (matched.length >= 5) {
    strengths.push(`CV vocabulary overlaps the posting (${matched.length} terms).`);
  }
  if (prefKeywordHits.length) {
    strengths.push(`Matches your preferred keywords: ${prefKeywordHits.slice(0, 4).join(", ")}.`);
  }
  if (location && profile.preferences.locations.some((l) => jobBlob.toLowerCase().includes(l.toLowerCase()))) {
    strengths.push(`Location fits your preferences (${location}).`);
  }
  if (!strengths.length) {
    strengths.push("Some overlap between your CV and the job listing.");
  }

  const gaps: string[] = [];
  const missingPrefs = profile.preferences.keywords.filter(
    (k) => !jobBlob.toLowerCase().includes(k.toLowerCase())
  );
  if (missingPrefs.length && profile.preferences.keywords.length) {
    gaps.push(`Posting may not mention: ${missingPrefs.slice(0, 3).join(", ")}.`);
  }
  if (jobOnlySkills.length) {
    gaps.push(`Role mentions skills not found on your CV: ${jobOnlySkills.slice(0, 4).join(", ")}.`);
  }
  if (titleScore < 0.55) {
    gaps.push("Job title may not match your target seniority or role type.");
  }
  if (!description.trim()) {
    gaps.push("Limited job description available — score is based mainly on title and CV keywords.");
  }

  const summary =
    `Keyword match (${score}/100) for ${title} at ${company}. ` +
    `This is automated keyword/title scoring — not a full LLM review. Scores vary by role; re-analyze with Ollama for deeper comparison. ` +
    (skillHits.length ? `Overlap: ${skillHits.slice(0, 4).join(", ")}.` : "");

  console.log(`[ai] local-keywords scored "${title}" at ${company} → ${score}`);

  return {
    aiMatchScore: score,
    matchSummary: summary,
    matchStrengths: strengths.slice(0, 5),
    matchGaps: gaps.slice(0, 4),
    matchRecommendation: scoreToRecommendation(score),
  };
}
