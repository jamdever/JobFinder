import type { JobMatchAnalysis } from "./types.js";
import { parseJsonFromLlm } from "./llm.js";

function scoreToRecommendation(
  score: number
): JobMatchAnalysis["matchRecommendation"] {
  if (score >= 85) return "strong_match";
  if (score >= 70) return "good_match";
  if (score >= 55) return "moderate_match";
  if (score >= 40) return "weak_match";
  return "not_recommended";
}

export function parseMatchAnalysis(content: string): Partial<JobMatchAnalysis> {
  try {
    return parseJsonFromLlm<Partial<JobMatchAnalysis>>(content);
  } catch {
    /* loose parse for Ollama */
  }

  const scoreMatch = content.match(/"aiMatchScore"\s*:\s*(\d+)/i);
  const aiMatchScore = scoreMatch ? Number(scoreMatch[1]) : undefined;

  const summaryMatch = content.match(/"matchSummary"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  const matchSummary = summaryMatch?.[1]?.replace(/\\n/g, " ").replace(/\\"/g, '"');

  const recMatch = content.match(
    /"matchRecommendation"\s*:\s*"(strong_match|good_match|moderate_match|weak_match|not_recommended)"/i
  );

  const strengths = [...content.matchAll(/"matchStrengths"\s*:\s*\[([\s\S]*?)\]/gi)][0];
  const matchStrengths: string[] = [];
  if (strengths?.[1]) {
    for (const m of strengths[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      matchStrengths.push(m[1].replace(/\\n/g, " "));
    }
  }

  const gapsBlock = [...content.matchAll(/"matchGaps"\s*:\s*\[([\s\S]*?)\]/gi)][0];
  const matchGaps: string[] = [];
  if (gapsBlock?.[1]) {
    for (const m of gapsBlock[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      matchGaps.push(m[1].replace(/\\n/g, " "));
    }
  }

  if (aiMatchScore == null && !matchSummary) {
    throw new Error("Could not parse match analysis from AI response");
  }

  const score = aiMatchScore ?? 50;
  return {
    aiMatchScore: score,
    matchSummary: matchSummary ?? "Analysis completed.",
    matchStrengths,
    matchGaps,
    matchRecommendation:
      (recMatch?.[1] as JobMatchAnalysis["matchRecommendation"]) ??
      scoreToRecommendation(score),
  };
}
