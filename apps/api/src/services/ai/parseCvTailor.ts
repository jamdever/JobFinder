import type { CvTailorResult } from "./types.js";
import { parseJsonFromLlm } from "./llm.js";

function parseChangesBlock(block: string): string[] {
  return block
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 2)
    .slice(0, 8);
}

/** Ollama-friendly format (no JSON — avoids broken escapes in long CV text). */
export function parseCvTailorDelimited(content: string): CvTailorResult {
  const normalized = content.replace(/\r\n/g, "\n");
  const changesMatch = normalized.match(/---CHANGES---\s*([\s\S]*?)(?=---CV---|$)/i);
  const cvMatch = normalized.match(/---CV---\s*([\s\S]*?)(?=---END---|$)/i);

  if (cvMatch?.[1]?.trim()) {
    const tailoredCvMarkdown = cvMatch[1].trim();
    const keyChanges = changesMatch?.[1]
      ? parseChangesBlock(changesMatch[1])
      : ["Tailored CV generated for this role."];
    if (tailoredCvMarkdown.length >= 80) {
      return { tailoredCvMarkdown, keyChanges };
    }
  }

  const fence = normalized.match(/```(?:markdown)?\s*([\s\S]*?)```/i);
  if (fence?.[1] && fence[1].trim().length >= 80) {
    return {
      tailoredCvMarkdown: fence[1].trim(),
      keyChanges: changesMatch?.[1]
        ? parseChangesBlock(changesMatch[1])
        : ["CV provided in markdown block."],
    };
  }

  throw new Error("Could not read tailored CV from model output. Try again.");
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
    /"\s*,\s*"keyChanges"/,
    /"\s*,\s*"tailoredCvMarkdown"/,
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

export function parseCvTailorJson(content: string): CvTailorResult {
  try {
    const data = parseJsonFromLlm<{
      tailoredCvMarkdown?: string;
      keyChanges?: string[];
    }>(content);
    const tailoredCvMarkdown = data.tailoredCvMarkdown?.trim();
    if (tailoredCvMarkdown && tailoredCvMarkdown.length >= 80) {
      return {
        tailoredCvMarkdown,
        keyChanges: Array.isArray(data.keyChanges) ? data.keyChanges.slice(0, 8) : [],
      };
    }
  } catch {
    /* try loose extraction */
  }

  const tailoredCvMarkdown = extractLooseStringField(content, "tailoredCvMarkdown")?.trim();
  if (!tailoredCvMarkdown || tailoredCvMarkdown.length < 80) {
    throw new Error(
      "Could not parse tailored CV from AI response. Try again or use AI_PROVIDER=local for simple highlighting."
    );
  }

  const keyChanges = extractStringArrayField(content, "keyChanges");
  return {
    tailoredCvMarkdown,
    keyChanges: keyChanges.length ? keyChanges : ["CV tailored for this role."],
  };
}

export function parseCvTailorResponse(content: string, useDelimiter: boolean): CvTailorResult {
  if (useDelimiter) {
    try {
      return parseCvTailorDelimited(content);
    } catch {
      return parseCvTailorJson(content);
    }
  }
  try {
    return parseCvTailorJson(content);
  } catch {
    return parseCvTailorDelimited(content);
  }
}
