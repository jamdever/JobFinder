import type { UserProfile } from "@jobfinder/shared";
import { chatCompletionText, getAiModelLabel, getAiProvider } from "./llm.js";
import {
  assertFormatPreserved,
  buildTailorInstructions,
  extractCvStructure,
  finalizeTailoredCv,
} from "./cvFormat.js";
import { parseCvTailorResponse } from "./parseCvTailor.js";
import { tailorCvLocally } from "./localCvTailor.js";
import type { CvTailorResult } from "./types.js";

export type { CvTailorResult } from "./types.js";

function assertPreservedStructure(original: string, tailored: string): void {
  assertFormatPreserved(original, tailored);
  const { headings } = extractCvStructure(original);
  const missing = headings.filter((h) => {
    const title = h.replace(/^#+\s*/, "").trim();
    return title.length > 2 && !tailored.toUpperCase().includes(title.toUpperCase());
  });
  if (missing.length > Math.max(1, Math.floor(headings.length * 0.3))) {
    throw new Error(
      "The tailored CV removed major sections from your original. Try Regenerate to keep your layout."
    );
  }
}

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
  structureInstructions: string;
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
    structureInstructions,
  } = params;

  const base = `Lightly adjust this CV for the role below. Output must look like a copy of the ORIGINAL CV with tiny edits — same fonts are not required, but same plain-text layout.

${structureInstructions}

TARGET ROLE
Title: ${title}
Company: ${company}
Location: ${location}
Salary: ${salary || "Not listed"}
Tags: ${tags.join(", ") || "None"}

Job description:
${jobDescription.slice(0, 6000)}
${matchContext}

CANDIDATE
Name: ${profile.personal.fullName}
Email: ${profile.personal.email}

ORIGINAL CV (copy this format exactly):
${resumeText.slice(0, 9000)}`;

  if (useDelimiter) {
    return {
      system: `You make minimal in-place edits to CVs. Never change the document format.\n\nReturn plain text in this EXACT format (not JSON):\n\n---CHANGES---\n- 3-5 bullets listing only the small word/phrase edits you made\n\n---CV---\nThe complete CV in the SAME plain-text format as the original (not markdown)`,
      user: base,
    };
  }

  return {
    system: `You make minimal in-place edits to CVs. Never change the document format.\nReturn only valid JSON.`,
    user: `${base}

Return JSON:
{
  "tailoredCvMarkdown": "full CV in the same plain format as the original",
  "keyChanges": ["3-5 short bullets — only actual small edits"]
}`,
  };
}

export async function tailorCvAgainstJob(params: {
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
}): Promise<CvTailorResult> {
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
      "CV text is too short. Upload your CV in Settings before tailoring."
    );
  }

  if (getAiProvider() === "local") {
    return tailorCvLocally({
      title,
      company,
      location,
      description,
      profile,
      resumeText,
    });
  }

  const jobDescription =
    description.trim() ||
    `Title: ${title}\nCompany: ${company}\nLocation: ${location}`;

  const matchContext =
    matchStrengths?.length || matchGaps?.length
      ? `
PRIOR MATCH ANALYSIS (use to emphasize strengths, do not invent skills to fix gaps)
Strengths: ${matchStrengths?.join("; ") || "None"}
Gaps: ${matchGaps?.join("; ") || "None"}`
      : "";

  const structure = extractCvStructure(resumeText);
  const structureInstructions = buildTailorInstructions(structure);
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
    structureInstructions,
  });

  const content = await chatCompletionText({
    temperature: 0.1,
    system,
    user,
  });

  console.log(`[ai] ${getAiModelLabel()} lightly tailored CV for "${title}" at ${company}`);

  let result = parseCvTailorResponse(content, useDelimiter);
  result = {
    ...result,
    tailoredCvMarkdown: finalizeTailoredCv(resumeText, result.tailoredCvMarkdown),
  };
  assertPreservedStructure(resumeText, result.tailoredCvMarkdown);
  return result;
}
