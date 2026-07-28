import type { CoverLetterResult } from "./types.js";
import { parseJsonFromLlm } from "./llm.js";

function parseBulletBlock(block: string): string[] {
  return block
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 2)
    .slice(0, 6);
}

export function parseCoverLetterDelimited(content: string): CoverLetterResult {
  const normalized = content.replace(/\r\n/g, "\n");
  const pointsMatch = normalized.match(/---HIGHLIGHTS---\s*([\s\S]*?)(?=---LETTER---|$)/i);
  const letterMatch = normalized.match(/---LETTER---\s*([\s\S]*?)(?=---END---|$)/i);

  if (letterMatch?.[1]?.trim()) {
    const coverLetter = letterMatch[1].trim();
    if (coverLetter.length >= 120) {
      return {
        coverLetter,
        keyPoints: pointsMatch?.[1]
          ? parseBulletBlock(pointsMatch[1])
          : ["Cover letter generated for this role."],
      };
    }
  }

  throw new Error("Could not read cover letter from model output. Try again.");
}

function extractLooseStringField(raw: string, field: string): string | null {
  const marker = `"${field}"`;
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const colon = raw.indexOf(":", idx + marker.length);
  if (colon < 0) return null;
  const quoteStart = raw.indexOf('"', colon + 1);
  if (quoteStart < 0) return null;

  const afterField = raw.slice(quoteStart + 1);
  const endPatterns = [
    /"\s*,\s*"keyPoints"/,
    /"\s*,\s*"coverLetter"/,
    /"\s*\n\s*\}/,
    /"\s*\}/,
  ];
  let end = afterField.length;
  for (const pat of endPatterns) {
    const m = afterField.match(pat);
    if (m?.index != null && m.index > 0) {
      end = Math.min(end, m.index);
    }
  }

  return afterField
    .slice(0, end)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractStringArrayField(raw: string, field: string): string[] {
  const re = new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i");
  const m = raw.match(re);
  if (!m?.[1]) return [];
  const items: string[] = [];
  const strRe = /"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = strRe.exec(m[1])) !== null) {
    items.push(match[1].replace(/\\n/g, " ").replace(/\\"/g, '"'));
  }
  return items;
}

export function parseCoverLetterJson(content: string): CoverLetterResult {
  try {
    const data = parseJsonFromLlm<{
      coverLetter?: string;
      cover_letter?: string;
      keyPoints?: string[];
      key_points?: string[];
    }>(content);
    const coverLetter = (data.coverLetter ?? data.cover_letter)?.trim();
    if (coverLetter && coverLetter.length >= 120) {
      const points = data.keyPoints ?? data.key_points;
      return {
        coverLetter,
        keyPoints: Array.isArray(points) ? points.slice(0, 6) : [],
      };
    }
  } catch {
    /* loose extraction */
  }

  const coverLetter =
    extractLooseStringField(content, "coverLetter")?.trim() ??
    extractLooseStringField(content, "cover_letter")?.trim();
  if (!coverLetter || coverLetter.length < 120) {
    throw new Error("Could not parse cover letter from AI response. Try again.");
  }

  const keyPoints =
    extractStringArrayField(content, "keyPoints") ||
    extractStringArrayField(content, "key_points");
  return {
    coverLetter,
    keyPoints: keyPoints.length ? keyPoints : ["Cover letter tailored for this role."],
  };
}

export function parseCoverLetterResponse(
  content: string,
  useDelimiter: boolean
): CoverLetterResult {
  if (useDelimiter) {
    try {
      return parseCoverLetterDelimited(content);
    } catch {
      return parseCoverLetterJson(content);
    }
  }
  try {
    return parseCoverLetterJson(content);
  } catch {
    return parseCoverLetterDelimited(content);
  }
}
