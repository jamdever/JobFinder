import type { UserProfile } from "@jobfinder/shared";
import { chatCompletionText, getAiModelLabel, getAiProvider } from "./llm.js";
import { parseMatchAnalysis } from "./parseMatch.js";
import { analyzeJobLocally } from "./localMatcher.js";
import type { JobMatchAnalysis } from "./types.js";

export type { JobMatchAnalysis } from "./types.js";

function validateRecommendation(
  value: string | undefined,
  score: number
): JobMatchAnalysis["matchRecommendation"] {
  const valid: JobMatchAnalysis["matchRecommendation"][] = [
    "strong_match",
    "good_match",
    "moderate_match",
    "weak_match",
    "not_recommended",
  ];
  if (value && valid.includes(value as JobMatchAnalysis["matchRecommendation"])) {
    return value as JobMatchAnalysis["matchRecommendation"];
  }
  if (score >= 85) return "strong_match";
  if (score >= 70) return "good_match";
  if (score >= 55) return "moderate_match";
  if (score >= 40) return "weak_match";
  return "not_recommended";
}

export async function analyzeJobAgainstCv(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  tags: string[];
  salary: string;
  profile: UserProfile;
  resumeText: string;
}): Promise<JobMatchAnalysis> {
  const { title, company, location, description, tags, salary, profile, resumeText } = params;

  if (!resumeText.trim() || resumeText.trim().length < 40) {
    throw new Error(
      "CV text is too short for matching. Upload your CV in Settings (PDF)."
    );
  }

  if (getAiProvider() === "local") {
    return analyzeJobLocally({
      title,
      company,
      location,
      description,
      tags,
      profile,
      resumeText,
    });
  }

  const jobDescription =
    description.trim() ||
    `No full job description was scraped. Infer fit from title, company, and location only.\nTitle: ${title}\nCompany: ${company}\nLocation: ${location}`;

  const content = await chatCompletionText({
    temperature: 0.2,
    system: `You are an expert career matcher. Compare job postings to a candidate's CV honestly.
Score 0-100 based on fit: skills, experience level, role alignment, location/remote fit, and career direction.
Never inflate scores. If the CV lacks required experience, score low and list gaps clearly.
Recommendations: strong_match (85+), good_match (70-84), moderate_match (55-69), weak_match (40-54), not_recommended (<40).
Return only valid JSON.`,
    user: `Analyze this job against the candidate's CV.

JOB
Title: ${title}
Company: ${company}
Location: ${location}
Salary: ${salary || "Not listed"}
Tags: ${tags.join(", ") || "None"}

Description:
${jobDescription.slice(0, 7000)}

CANDIDATE PREFERENCES
Target titles: ${profile.preferences.titles.join(", ")}
Keywords: ${profile.preferences.keywords.join(", ")}
Locations: ${profile.preferences.locations.join(", ")}

CV / RESUME:
${resumeText.slice(0, 9000)}

Return JSON:
{
  "aiMatchScore": number (0-100),
  "matchSummary": "2-3 sentence overview of fit",
  "matchStrengths": ["3-5 specific reasons candidate fits"],
  "matchGaps": ["0-4 honest gaps or concerns"],
  "matchRecommendation": "strong_match|good_match|moderate_match|weak_match|not_recommended"
}`,
  });

  console.log(`[ai] ${getAiModelLabel()} scored "${title}" at ${company}`);

  const data = parseMatchAnalysis(content);
  const score = Math.min(100, Math.max(0, Math.round(Number(data.aiMatchScore) || 0)));
  const recommendation = validateRecommendation(data.matchRecommendation, score);

  return {
    aiMatchScore: score,
    matchSummary: data.matchSummary ?? "No summary generated.",
    matchStrengths: Array.isArray(data.matchStrengths) ? data.matchStrengths.slice(0, 6) : [],
    matchGaps: Array.isArray(data.matchGaps) ? data.matchGaps.slice(0, 5) : [],
    matchRecommendation: recommendation,
  };
}
