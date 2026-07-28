import type { UserProfile } from "@jobfinder/shared";
import { chatCompletionText, getAiModelLabel, getAiProvider } from "./llm.js";
import { generateCoverLetterLocally } from "./localCoverLetter.js";
import { parseCoverLetterResponse } from "./parseCoverLetter.js";
import type { CoverLetterResult } from "./types.js";

function buildUserPrompt(params: {
  title: string;
  company: string;
  location: string;
  salary: string;
  tags: string[];
  jobDescription: string;
  matchContext: string;
  profile: UserProfile;
  resumeText: string;
  useDelimiter: boolean;
}): { system: string; user: string } {
  const {
    title,
    company,
    location,
    salary,
    tags,
    jobDescription,
    matchContext,
    profile,
    resumeText,
    useDelimiter,
  } = params;

  const base = `Write a tailored cover letter for this job application.

TARGET ROLE
Title: ${title}
Company: ${company}
Location: ${location || "Not specified"}
Salary: ${salary || "Not listed"}
Tags: ${tags.join(", ") || "None"}

Job description:
${jobDescription.slice(0, 6000)}
${matchContext}

CANDIDATE
Name: ${profile.personal.fullName}
Email: ${profile.personal.email}
Location: ${profile.personal.location ?? "Not specified"}
Tone: ${profile.application.coverLetterTone}

RESUME (facts only — do not invent employers, degrees, or skills):
${resumeText.slice(0, 8000)}

RULES:
- Exactly 3 short paragraphs, under 350 words total.
- UK/Ireland professional business letter style (no markdown, no bullet lists in the letter body).
- Open with interest in this specific role and company; close with a polite call to action.
- Use only experience and skills supported by the resume.
- Address gaps honestly only if relevant; do not claim skills not on the resume.`;

  if (useDelimiter) {
    return {
      system: `You write honest, tailored job cover letters. Return plain text in this EXACT format (not JSON):

---HIGHLIGHTS---
- 3-5 bullets: strengths you emphasized (short phrases)

---LETTER---
The full cover letter (3 paragraphs, plain text)

---END---`,
      user: base,
    };
  }

  return {
    system:
      "You write honest, tailored job cover letters. Return only valid JSON. Never invent experience.",
    user: `${base}

Return JSON:
{
  "coverLetter": "full letter as plain text, 3 paragraphs",
  "keyPoints": ["3-5 short bullets on what you emphasized"]
}`,
  };
}

export async function generateCoverLetterAgainstJob(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  tags: string[];
  salary: string;
  profile: UserProfile;
  resumeText: string;
  matchStrengths?: string[];
  matchGaps?: string[];
}): Promise<CoverLetterResult> {
  const {
    title,
    company,
    location,
    description,
    tags,
    salary,
    profile,
    resumeText,
    matchStrengths,
    matchGaps,
  } = params;

  if (!resumeText.trim() || resumeText.trim().length < 40) {
    throw new Error(
      "CV text is too short. Upload your CV in Settings before generating a cover letter."
    );
  }

  if (getAiProvider() === "local") {
    return generateCoverLetterLocally({
      title,
      company,
      location,
      description,
      profile,
      resumeText,
      matchStrengths,
    });
  }

  const jobDescription =
    description.trim() ||
    `Title: ${title}\nCompany: ${company}\nLocation: ${location}`;

  const matchContext =
    matchStrengths?.length || matchGaps?.length
      ? `
PRIOR MATCH ANALYSIS (emphasize strengths; do not invent skills to fix gaps)
Strengths: ${matchStrengths?.join("; ") || "None"}
Gaps: ${matchGaps?.join("; ") || "None"}`
      : "";

  const useDelimiter = getAiProvider() === "ollama";
  const { system, user } = buildUserPrompt({
    title,
    company,
    location,
    salary,
    tags,
    jobDescription,
    matchContext,
    profile,
    resumeText,
    useDelimiter,
  });

  const content = await chatCompletionText({
    temperature: 0.35,
    system,
    user,
  });

  console.log(
    `[ai] ${getAiModelLabel()} cover letter for "${title}" at ${company}`
  );

  return parseCoverLetterResponse(content, useDelimiter);
}
