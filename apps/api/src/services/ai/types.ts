import type { MatchRecommendation } from "@jobfinder/shared";

export interface JobMatchAnalysis {
  aiMatchScore: number;
  matchSummary: string;
  matchStrengths: string[];
  matchGaps: string[];
  matchRecommendation: MatchRecommendation;
}

export interface CvTailorResult {
  tailoredCvMarkdown: string;
  keyChanges: string[];
}

export interface CoverLetterResult {
  coverLetter: string;
  keyPoints: string[];
}
