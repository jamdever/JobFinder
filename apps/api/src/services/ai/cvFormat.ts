export type CvFormatStyle = "plain_caps" | "markdown" | "mixed";

const CAPS_SECTIONS = [
  "PROFILE",
  "EDUCATION",
  "TECHNICAL SKILLS",
  "RELEVANT EXPERIENCE",
  "EXPERIENCE",
  "ADDITIONAL",
  "SKILLS",
  "SUMMARY",
];

export function detectCvFormat(text: string): CvFormatStyle {
  if (/^#{1,4}\s/m.test(text)) return "markdown";
  const capsCount = CAPS_SECTIONS.filter((s) =>
    new RegExp(`^${s}\\s*$`, "im").test(text)
  ).length;
  if (capsCount >= 2) return "plain_caps";
  return "mixed";
}

export function extractCvStructure(resumeText: string): {
  format: CvFormatStyle;
  headings: string[];
  usesTabBullets: boolean;
  usesRoundBullets: boolean;
  usesPipeSeparators: boolean;
} {
  const format = detectCvFormat(resumeText);
  const capsHeadings = CAPS_SECTIONS.filter((s) =>
    new RegExp(`^${s}\\s*$`, "im").test(resumeText)
  );
  const mdHeadings = [...resumeText.matchAll(/^#{1,4}\s+.+$/gm)].map((m) =>
    m[0].trim()
  );
  const headings = capsHeadings.length > 0 ? capsHeadings : mdHeadings;

  return {
    format,
    headings,
    usesTabBullets: /^\t+[\*\-]/m.test(resumeText),
    usesRoundBullets: /^[•\u2022]\s/m.test(resumeText),
    usesPipeSeparators: /\|.+\|/.test(resumeText) || / \| /.test(resumeText),
  };
}

const SECTION_MAP: Record<string, string> = {
  profile: "PROFILE",
  education: "EDUCATION",
  "technical skills": "TECHNICAL SKILLS",
  skills: "TECHNICAL SKILLS",
  "relevant experience": "RELEVANT EXPERIENCE",
  experience: "RELEVANT EXPERIENCE",
  additional: "ADDITIONAL",
  summary: "PROFILE",
};

/** If the model returned markdown, convert back toward the user's plain CV style. */
export function enforceOriginalFormat(original: string, tailored: string): string {
  const format = detectCvFormat(original);
  if (format !== "plain_caps") return tailored;

  let out = tailored.replace(/\r\n/g, "\n");

  out = out.replace(/^#{1,4}\s+(.+)$/gm, (_, title: string) => {
    const key = title.trim().toLowerCase();
    if (SECTION_MAP[key]) return SECTION_MAP[key];
    return title.trim();
  });

  out = out.replace(/^\t+\*\s+/gm, "• ");
  out = out.replace(/^\s*[\*\-]\s+/gm, "• ");
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  out = out.replace(/^---\s*$/gm, "");

  return out.trim();
}

export function buildFormatInstructions(structure: ReturnType<typeof extractCvStructure>): string {
  if (structure.format === "plain_caps") {
    return `OUTPUT FORMAT — PLAIN TEXT ONLY (match the original CV exactly):
- Do NOT use Markdown: no # ## ### ####, no **bold**, no backticks.
- Section titles are ALL CAPS on their own line, exactly as in the original:
  ${structure.headings.map((h) => h).join(", ")}
- Keep the contact line style: phone | email | LinkedIn | location (pipes, one line).
- Job header is ONE line only: Role — Company, City | Mon YYYY (e.g. Systems Engineer — CBE, Claremorris, Ireland | Jan 2026)
- Do NOT put the company description on the same line as the job header.
- Company description (one short sentence) goes on the NEXT line after the job header, then bullets below.
- Use round bullet character • for list items (not * or - or tabs).
- Skills lines: Category: item, item, item (e.g. Backend: C#, .NET, ...)
- Preserve blank lines between sections like the original.
- PROFILE: one paragraph only (not multiple lines).`;
  }

  if (structure.format === "markdown") {
    const headingList =
      structure.headings.length > 0
        ? structure.headings.map((h) => `  - ${h}`).join("\n")
        : "  (same headings as original)";
    const bulletNote = structure.usesTabBullets
      ? "Keep TAB-indented bullets."
      : structure.usesRoundBullets
        ? "Keep • bullets."
        : "Keep the same bullet style as the original.";
    return `Keep markdown structure:\n${headingList}\n${bulletNote}`;
  }

  return `Keep the same visual structure, spacing, and section order as the original CV. Plain text — no Markdown unless the original already uses # headings.`;
}

export const CV_ONE_PAGE_RULES = `ONE PAGE ONLY:
- The entire CV must fit on a single A4 page when printed (same density as the original).
- Do NOT add lines, bullets, or sections that would push content to a second page.
- Keep the same number of bullets per job as the original (do not add new bullets).
- If you edit PROFILE, keep it the same length or slightly shorter — never longer than the original profile.`;

export const CV_EXPERIENCE_RULES = `RELEVANT EXPERIENCE FORMAT:
- Each role: one job header line, then optional company line, then bullet points.
- Job header format exactly: Title — Company, Town, Ireland | Mon YYYY
- Example: Systems Engineer — CBE, Claremorris, Ireland | Jan 2026
- Never append company description text to the job header line.
- Company blurb (if any) is its own line on the next row, e.g. "CBE is Ireland's leading provider of retail technology solutions."`;

export const CV_PROFILE_RULES = `PROFILE SECTION:
- PROFILE must be exactly ONE paragraph (one block of text).
- Do NOT split PROFILE across multiple lines, bullet points, or sub-headings.
- Use 3–5 sentences in a single flowing paragraph (like the original CV).`;

export const CV_PRESERVE_RULES = `LIGHT TAILORING — edit the existing CV in place. Do NOT redesign or reformat it.

MUST KEEP:
- The same section headings, order, line breaks, and punctuation style as the ORIGINAL CV below.
- Every employer, date, degree, and tool from the original.
- One-page length (see rules below).

ALLOWED (small only):
- 1–2 phrases in PROFILE aligned to the target job (still one paragraph).
- A few words in existing bullets for job keywords (only if already true).
- Minor grammar fixes on lines you touch.

FORBIDDEN:
- Converting the CV to a different format (e.g. plain CV → markdown headings).
- Rewriting from scratch, new sections, or removing content.
- Inventing experience or skills.
- Multi-line or bulleted PROFILE.`;

export function buildTailorInstructions(
  structure: ReturnType<typeof extractCvStructure>
): string {
  return `${CV_PRESERVE_RULES}\n\n${CV_ONE_PAGE_RULES}\n\n${CV_PROFILE_RULES}\n\n${CV_EXPERIENCE_RULES}\n\n${buildFormatInstructions(structure)}`;
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";

/** Job title line: Role — Company, location | date */
function isAllCapsHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 45) return false;
  return t === t.toUpperCase() && /^[A-Z][A-Z\s/&]+$/.test(t);
}

export function isJobHeaderLine(line: string): boolean {
  const t = line.trim();
  if (t.startsWith("•") || isAllCapsHeading(t)) return false;
  if (!/ — .+\|/.test(t)) return false;
  return new RegExp(`\\|\\s*${MONTH}\\s+\\d{4}`, "i").test(t);
}

export function formatJobHeaderLine(line: string): string {
  let t = line.trim();
  t = t.replace(
    new RegExp(`(\\|\\s*${MONTH}\\s+\\d{4})\\s*[–-]\\s*Present\\s*$`, "i"),
    "$1"
  );
  return t.replace(/\s{2,}/g, " ");
}

/** Split company description accidentally merged onto the job header line. */
export function splitJobHeaderFromDescription(line: string): string[] {
  const trimmed = line.trim();
  if (!isJobHeaderLine(trimmed) && !/ — .+\|/.test(trimmed)) {
    return [trimmed];
  }

  const split = trimmed.replace(
    new RegExp(
      `(\\|\\s*${MONTH}\\s+\\d{4})(?:\\s*[–-]\\s*Present)?\\s+(?=[A-Z][A-Za-z])`
    ),
    "$1\n"
  );

  return split
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/ — .+\|/.test(p) ? formatJobHeaderLine(p) : p));
}

export function normalizeExperienceLayout(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const raw of lines) {
    if (!raw.trim()) {
      out.push("");
      continue;
    }

    if (/ — .+\|/.test(raw) && !raw.trim().startsWith("•") && raw.length > 70) {
      for (const part of splitJobHeaderFromDescription(raw)) {
        out.push(part);
      }
      continue;
    }

    if (isJobHeaderLine(raw)) {
      out.push(formatJobHeaderLine(raw));
      continue;
    }

    out.push(raw.trimEnd());
  }

  return collapseExtraBlankLines(out.join("\n"));
}

const NEXT_SECTION_RE =
  /^(PROFILE|EDUCATION|TECHNICAL SKILLS|RELEVANT EXPERIENCE|EXPERIENCE|ADDITIONAL|SKILLS|SUMMARY)\s*$/i;

function isSectionHeading(line: string): boolean {
  const t = line.trim();
  return NEXT_SECTION_RE.test(t) || /^#{1,4}\s+/.test(t);
}

/** Extract PROFILE / Profile section body text. */
export function extractProfileBody(text: string): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (/^PROFILE\s*$/i.test(t) || /^##\s*profile\s*$/i.test(t)) {
      i++;
      break;
    }
    i++;
  }
  while (i < lines.length && !lines[i].trim()) i++;
  const parts: string[] = [];
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      if (parts.length) break;
      i++;
      continue;
    }
    if (isSectionHeading(t) && !/^PROFILE/i.test(t)) break;
    if (t.startsWith("•") || t.startsWith("*") || t.startsWith("-")) break;
    parts.push(t);
    i++;
  }
  return parts.length ? parts.join(" ") : null;
}

function replaceProfileBody(text: string, paragraph: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let headerIdx = -1;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (/^PROFILE\s*$/i.test(t) || /^##\s*profile\s*$/i.test(t)) {
      headerIdx = i;
      i++;
      break;
    }
    i++;
  }
  if (headerIdx < 0) return text;

  while (i < lines.length && !lines[i].trim()) i++;
  const bodyStart = i;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t && partsStarted(lines, bodyStart, i)) break;
    if (isSectionHeading(t) && !/^PROFILE/i.test(t)) break;
    i++;
  }

  const header = lines[headerIdx];
  const before = lines.slice(0, headerIdx + 1);
  const after = lines.slice(i);
  return [...before, "", paragraph, "", ...after].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function partsStarted(lines: string[], start: number, end: number): boolean {
  for (let j = start; j < end; j++) {
    if (lines[j].trim()) return true;
  }
  return false;
}

/** Force PROFILE into a single paragraph. */
export function mergeProfileParagraph(text: string): string {
  const body = extractProfileBody(text);
  if (!body) return text;
  const paragraph = body.replace(/\s+/g, " ").trim();
  return replaceProfileBody(text, paragraph);
}

function collapseExtraBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Keep tailored CV within original one-page size (original text is the reference). */
export function enforceOnePageLength(original: string, tailored: string): string {
  const maxChars = Math.ceil(original.length * 1.02);
  let out = collapseExtraBlankLines(tailored);
  if (out.length <= maxChars) return out;

  const origProfile = extractProfileBody(original);
  let profile = extractProfileBody(out);
  if (profile && origProfile && profile.length > origProfile.length * 1.12) {
    const target = Math.ceil(origProfile.length * 1.08);
    const sentences = profile.match(/[^.!?]+[.!?]+/g) ?? [profile];
    let shortened = "";
    for (const s of sentences) {
      if ((shortened + s).length > target) break;
      shortened += s;
    }
    profile = (shortened || profile.slice(0, target)).trim();
    out = replaceProfileBody(out, profile);
  }

  if (out.length <= maxChars) return out;

  out = collapseExtraBlankLines(out);
  if (out.length > maxChars) {
    console.warn(
      `[cv] tailored CV still ${out.length} chars (max ${maxChars}); trimming trailing content`
    );
    out = out.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  }
  return out;
}

/** Apply format fixes, profile paragraph, and one-page length. */
export function finalizeTailoredCv(original: string, tailored: string): string {
  let out = enforceOriginalFormat(original, tailored);
  out = normalizeExperienceLayout(out);
  out = mergeProfileParagraph(out);
  out = enforceOnePageLength(original, out);
  return out;
}

export function assertFormatPreserved(original: string, tailored: string): void {
  const origFormat = detectCvFormat(original);
  if (origFormat === "plain_caps" && /^#{1,4}\s/m.test(tailored)) {
    throw new Error(
      "The model converted your CV to markdown. Retrying with plain-text format…"
    );
  }
  const minLen = Math.floor(original.length * 0.7);
  if (tailored.length < minLen) {
    throw new Error(
      "The tailored CV was much shorter than your original. Try Regenerate again."
    );
  }
}
