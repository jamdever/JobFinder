import type { UserProfile } from "@jobfinder/shared";
import type { CoverLetterResult } from "./types.js";

function overlapTerms(resumeText: string, jobText: string, profile: UserProfile): string[] {
  const jobLower = jobText.toLowerCase();
  const resumeLower = resumeText.toLowerCase();
  const terms = new Set<string>();

  for (const k of profile.preferences.keywords) {
    if (jobLower.includes(k.toLowerCase()) && resumeLower.includes(k.toLowerCase())) {
      terms.add(k);
    }
  }

  const tech = [
    "c#", ".net", "asp.net", "javascript", "typescript", "python", "react", "node",
    "sql", "mongodb", "aws", "docker", "systems", "engineer",
  ];
  for (const t of tech) {
    if (jobLower.includes(t) && resumeLower.includes(t)) terms.add(t);
  }

  return [...terms].slice(0, 5);
}

/** Template cover letter when AI_PROVIDER=local (no LLM). */
export function generateCoverLetterLocally(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  profile: UserProfile;
  resumeText: string;
  matchStrengths?: string[];
}): CoverLetterResult {
  const { title, company, location, description, profile, resumeText, matchStrengths } =
    params;
  const name = profile.personal.fullName;
  const jobText = [title, company, location, description].join(" ");
  const terms = overlapTerms(resumeText, jobText, profile);
  const strengths = (matchStrengths ?? []).slice(0, 2);

  const skillsLine =
    terms.length > 0
      ? `My background aligns with this role through experience with ${terms.join(", ")}.`
      : `My experience matches the responsibilities described for this ${title} role.`;

  const strengthLine =
    strengths.length > 0
      ? ` ${strengths[0].endsWith(".") ? strengths[0] : `${strengths[0]}.`}`
      : "";

  const coverLetter = `Dear Hiring Manager,

I am writing to express my interest in the ${title} position at ${company}${location ? ` in ${location}` : ""}. ${skillsLine}${strengthLine}

I would welcome the opportunity to discuss how my skills and experience can support your team. Thank you for considering my application.

Sincerely,
${name}`;

  const keyPoints = [
    `Role: ${title} at ${company}`,
    ...(terms.length ? [`Highlighted skills: ${terms.join(", ")}`] : []),
    ...(strengths.length ? [`From match analysis: ${strengths[0]}`] : []),
    "Set AI_PROVIDER=ollama for a fuller tailored letter.",
  ];

  console.log(`[ai] local-keywords cover letter for "${title}" at ${company}`);

  return { coverLetter, keyPoints };
}
