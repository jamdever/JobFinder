import type { UserProfile } from "@jobfinder/shared";
import { finalizeTailoredCv } from "./cvFormat.js";
import type { CvTailorResult } from "./types.js";

function matchingTerms(resumeText: string, jobText: string, profile: UserProfile): string[] {
  const jobLower = jobText.toLowerCase();
  const resumeLower = resumeText.toLowerCase();
  const terms = new Set<string>();

  for (const k of profile.preferences.keywords) {
    if (jobLower.includes(k.toLowerCase()) && resumeLower.includes(k.toLowerCase())) {
      terms.add(k);
    }
  }

  const tech = [
    "javascript", "typescript", "python", "java", "react", "node", "sql", "mongodb",
    "aws", "docker", "git", "html", "css", "api", ".net", "csharp", "asp.net",
  ];
  for (const t of tech) {
    if (jobLower.includes(t) && resumeLower.includes(t)) terms.add(t);
  }

  return [...terms].slice(0, 6);
}

/** Minimal in-place tweaks — keeps original CV structure and styling. */
export function tailorCvLocally(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  profile: UserProfile;
  resumeText: string;
}): CvTailorResult {
  const { title, company, location, description, profile, resumeText } = params;
  const jobText = [title, company, location, description].join(" ");
  const terms = matchingTerms(resumeText, jobText, profile);
  const keyChanges: string[] = [];

  let output = resumeText.trim();

  const profileSection =
    output.match(/(^##\s*Profile\s*$\n)([\s\S]*?)(?=^##\s|\Z)/im) ??
    output.match(/(^PROFILE\s*$\n)([\s\S]*?)(?=^[A-Z][A-Z\s]{2,}\s*$|\Z)/im);
  if (profileSection) {
    const body = profileSection[2].trim();
    if (!body.toLowerCase().includes(title.toLowerCase().slice(0, 12))) {
      const extra =
        terms.length > 0
          ? ` Targeting ${title} at ${company}; emphasis: ${terms.join(", ")}.`
          : ` Targeting ${title} at ${company}.`;
      const updated = body.endsWith(".") ? body + extra : body + "." + extra;
      output = output.replace(profileSection[0], profileSection[1] + updated + "\n\n");
      keyChanges.push("Added one targeting phrase to your Profile section.");
    }
  } else {
    keyChanges.push("No Profile section found — original CV kept unchanged.");
  }

  keyChanges.push("All section headings, bullets, and layout match your uploaded CV.");
  if (terms.length) {
    keyChanges.push(`Role-aligned keywords already on your CV: ${terms.join(", ")}.`);
  }
  keyChanges.push("Use Ollama mode for slightly smarter in-place word tweaks.");

  output = finalizeTailoredCv(resumeText, output);
  keyChanges.push("PROFILE kept as one paragraph; length capped to one page.");

  console.log(`[ai] local-keywords light tweak for "${title}" at ${company}`);

  return { tailoredCvMarkdown: output, keyChanges };
}
