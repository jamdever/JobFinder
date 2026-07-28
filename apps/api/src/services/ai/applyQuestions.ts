import type { UserProfile } from "@jobfinder/shared";
import { resolveProfileFieldAnswer } from "../apply/formFiller.js";
import {
  assertAiConfigured,
  chatCompletionText,
  getAiProvider,
  parseJsonFromLlm,
} from "./llm.js";

export type ApplyFieldType =
  | "number"
  | "text"
  | "textarea"
  | "select"
  | "combobox"
  | "radio"
  | "checkbox";

export interface ApplyQuestionInput {
  label: string;
  fieldType: ApplyFieldType;
  options?: string[];
}

export interface ApplyQuestionContext {
  jobTitle: string;
  company: string;
  jobDescription: string;
  resumeText: string;
  coverLetter: string;
  profile: UserProfile;
}

/** Default for "years of experience with X" when CV has no explicit year count. */
export const DEFAULT_YEARS_EXPERIENCE = "1";

/** LinkedIn often requires a decimal > 0.0 (e.g. 1.0, 2.5). */
export const DEFAULT_DECIMAL_EXPERIENCE = "1.0";

export function isYearsExperienceQuestion(label: string, fieldType?: ApplyFieldType): boolean {
  const hay = label.toLowerCase();
  return (
    fieldType === "number" ||
    /years?\s+of\s+(work\s+)?experience/i.test(hay) ||
    /how\s+many\s+years/i.test(hay) ||
    /years?\s+experience/i.test(hay) ||
    /what is your experience/i.test(hay) ||
    /experience\s+with/i.test(hay) ||
    /decimal number/i.test(hay)
  );
}

export function requiresDecimalExperienceValue(label: string): boolean {
  const hay = label.toLowerCase();
  return (
    isYearsExperienceQuestion(label) ||
    /decimal number|larger than 0/i.test(hay)
  );
}

/** Format for LinkedIn "decimal number larger than 0.0" fields. */
export function normalizeDecimalExperienceAnswer(
  answer: string,
  _label?: string
): string {
  const parsed = parseFloat(String(answer).replace(/[^\d.]/g, ""));
  let n = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  if (n > 99) n = 99;
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(1) : String(rounded);
}

function profileSummary(profile: UserProfile): string {
  const p = profile.personal;
  return [
    p.fullName && `Name: ${p.fullName}`,
    p.email && `Email: ${p.email}`,
    p.location && `Location: ${p.location}`,
    p.phone && `Phone: ${p.phone}`,
    p.linkedinUrl && `LinkedIn: ${p.linkedinUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function clampNumber(answer: string, label: string, defaultWhenEmpty = DEFAULT_YEARS_EXPERIENCE): string {
  const n = parseInt(answer.replace(/[^\d]/g, ""), 10);
  if (Number.isNaN(n)) return defaultWhenEmpty;
  const range = label.match(/between\s+(\d+)\s+and\s+(\d+)/i);
  const max = range ? parseInt(range[2], 10) : 99;
  const min = range ? parseInt(range[1], 10) : 0;
  const clamped = Math.min(max, Math.max(min, n));
  return String(clamped);
}

/** Years-of-experience answers: never leave blank/zero; use decimal when form expects it. */
export function normalizeYearsExperienceAnswer(
  answer: string,
  label: string,
  fieldType?: ApplyFieldType
): string {
  if (!isYearsExperienceQuestion(label, fieldType)) return answer.trim();
  const clamped = clampNumber(answer, label, DEFAULT_YEARS_EXPERIENCE);
  if (clamped === "0") {
    return normalizeDecimalExperienceAnswer(DEFAULT_YEARS_EXPERIENCE, label);
  }
  if (requiresDecimalExperienceValue(label) || fieldType === "number") {
    return normalizeDecimalExperienceAnswer(clamped, label);
  }
  return normalizeDecimalExperienceAnswer(clamped, label);
}

/** Infer field type from question wording (avoid treating email/name as yes/no). */
export function inferApplyFieldType(
  label: string,
  declared?: ApplyFieldType
): ApplyFieldType {
  if (declared && declared !== "radio") return declared;
  const hay = label.toLowerCase();
  if (/cover letter|add cover/i.test(hay)) return "textarea";
  if (isYearsExperienceQuestion(label)) return "number";
  if (/^(what is your|enter your|your )/.test(hay) && /email|phone|name|address|linkedin|url/i.test(hay)) {
    return "text";
  }
  if (
    questionFieldTypeIsChoice(declared) ||
    (isYesNoQuestion(label) &&
      !/email|phone|name|address|cover letter|linkedin|portfolio/i.test(hay))
  ) {
    return declared ?? "radio";
  }
  return declared ?? "text";
}

function questionFieldTypeIsChoice(t?: ApplyFieldType): boolean {
  return t === "radio" || t === "select" || t === "combobox";
}

/** Keyword fallback when AI is unavailable (local provider). */
export function heuristicApplyAnswer(
  question: ApplyQuestionInput,
  ctx: ApplyQuestionContext
): string {
  const label = question.label.toLowerCase();
  const resume = ctx.resumeText.toLowerCase();
  const fieldType = inferApplyFieldType(question.label, question.fieldType);

  const profileAnswer = resolveProfileFieldAnswer(question.label, ctx);
  if (profileAnswer) return profileAnswer;

  if (isYearsExperienceQuestion(question.label, question.fieldType)) {
    const techMatch = label.match(/(?:experience\s+with|with)\s+(.+?)(?:\?|\*|\.|$)/i);
    const topic = techMatch?.[1]?.toLowerCase() ?? label;
    const topicWords = topic
      .split(/[\s,/]+|\band\b/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1);
    const skillAliases: Record<string, string[]> = {
      ai: ["ai", "llm", "machine learning", "ml", "generative", "gpt"],
      react: ["react", "reactjs", "react.js"],
      node: ["node", "nodejs", "node.js"],
    };
    let hits = 0;
    for (const w of topicWords) {
      if (resume.includes(w)) hits++;
      for (const aliases of Object.values(skillAliases)) {
        if (aliases.some((a) => w.includes(a) || a.includes(w)) && aliases.some((a) => resume.includes(a))) {
          hits++;
        }
      }
    }
    if (hits >= 1 || topicWords.some((w) => resume.includes(w))) {
      const yearMatch = resume.match(
        new RegExp(`(\\d+(?:\\.\\d+)?)\\+?\\s*years?[^.\\n]{0,50}${topicWords[0] || "x"}`, "i")
      );
      if (yearMatch) {
        return normalizeYearsExperienceAnswer(yearMatch[1], question.label, question.fieldType);
      }
      return normalizeYearsExperienceAnswer(DEFAULT_YEARS_EXPERIENCE, question.label, question.fieldType);
    }
    const knownTech =
      /mongodb|sql|java|python|javascript|typescript|react|node|angular|vue|aws|azure|gcp|docker|kubernetes|llm|\.net|net framework/i;
    if (knownTech.test(topic)) {
      for (const kw of topicWords) {
        if (kw.length > 2 && (resume.includes(kw) || knownTech.test(kw))) {
          return normalizeYearsExperienceAnswer(DEFAULT_YEARS_EXPERIENCE, question.label, question.fieldType);
        }
      }
    }
    return normalizeYearsExperienceAnswer(DEFAULT_YEARS_EXPERIENCE, question.label, question.fieldType);
  }

  const office = heuristicOfficeAttendance(question, ctx);
  if (office) return office;

  if (
    fieldType === "radio" ||
    fieldType === "select" ||
    fieldType === "combobox" ||
    (isYesNoQuestion(question.label, question.options) &&
      !/email|phone|name|address|cover letter/i.test(label))
  ) {
    const yesNo = heuristicYesNoAnswer(question, ctx);
    if (yesNo) return yesNo;
  }

  if (/authorized|eligible|right to work|legally/i.test(label)) {
    return matchAnswerToOption(
      "Yes",
      question.options ?? ["Yes", "No"]
    );
  }

  if (/completed the following level of education|level of education/i.test(label)) {
    const resume = ctx.resumeText.toLowerCase();
    if (/bachelor|b\.s\.|bs degree|undergraduate/i.test(label + resume)) {
      return matchAnswerToOption("Yes", question.options ?? ["Yes", "No"]);
    }
    if (/master|mba|phd|doctorate/i.test(label) && /master|mba|phd|doctorate/i.test(resume)) {
      return matchAnswerToOption("Yes", question.options ?? ["Yes", "No"]);
    }
    return matchAnswerToOption("No", question.options ?? ["Yes", "No"]);
  }

  if (/sponsorship|visa status|employment visa/i.test(label)) {
    return matchAnswerToOption("No", question.options ?? ["Yes", "No"]);
  }

  if (/salary|compensation|pay/i.test(label)) {
    return pickOption(question, ["Negotiable", "Competitive", "Open to discussion"]) || "Negotiable";
  }

  if (/notice|start date|availability|when can you/i.test(label)) {
    return pickOption(question, ["Immediately", "2 weeks", "1 month"]) || "Immediately";
  }

  if (questionFieldTypeIsChoice(fieldType)) {
    return matchAnswerToOption("Yes", question.options ?? ["Yes", "No"]);
  }

  if (/why|motivation|interest/i.test(label)) {
    return ctx.coverLetter.split("\n\n")[0]?.slice(0, 400) ?? ctx.coverLetter.slice(0, 400);
  }

  if (/cover letter|add cover/i.test(label)) {
    return ctx.coverLetter.slice(0, 2500);
  }

  if (fieldType === "textarea") {
    return ctx.coverLetter.slice(0, 2500);
  }

  if (isYearsExperienceQuestion(question.label, fieldType)) {
    return DEFAULT_YEARS_EXPERIENCE;
  }

  return "";
}

export function isYesNoQuestion(label: string, options?: string[]): boolean {
  const hay = label.toLowerCase();
  if (/^(are|do|have|is|can|will|did)\b/i.test(hay) && /\?/.test(hay)) return true;
  if (
    /legally authorized|sponsorship|located in|currently in|eligible to work|come into the office|days per week|able to come|work in the office|on.?site|resident of dublin|legal right to work|type of visa/i.test(
      hay
    )
  ) {
    return true;
  }
  const opts = (options ?? []).map((o) => o.toLowerCase());
  if (opts.includes("yes") && opts.includes("no")) return true;
  if (opts.includes("true") && opts.includes("false")) return true;
  return false;
}

/** Map "Yes"/"No" (or similar) to an exact dropdown/radio option label. */
export function matchAnswerToOption(answer: string, options: string[]): string {
  const trimmed = answer.trim();
  if (!options.length) return trimmed;
  const exact = options.find((o) => o.trim().toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const partial = options.find(
    (o) =>
      o.trim().length > 0 &&
      !/^select an option$/i.test(o) &&
      (o.toLowerCase().includes(trimmed.toLowerCase()) ||
        trimmed.toLowerCase().includes(o.toLowerCase()))
  );
  if (partial) return partial;
  const yesNo = trimmed.toLowerCase();
  if (yesNo === "yes" || yesNo === "no") {
    const hit = options.find((o) => o.trim().toLowerCase() === yesNo);
    if (hit) return hit;
    const mapped = yesNo === "yes" ? "true" : "false";
    const tf = options.find((o) => o.trim().toLowerCase() === mapped);
    if (tf) return tf;
    const tfLabel = options.find((o) => new RegExp(`^${mapped}$`, "i").test(o.trim()));
    if (tfLabel) return tfLabel;
  }
  if (yesNo === "true" || yesNo === "false") {
    const hit = options.find((o) => o.trim().toLowerCase() === yesNo);
    if (hit) return hit;
  }
  return options.find((o) => !/^select an option$/i.test(o)) ?? trimmed;
}

/** Pick best listbox option when labels are long (e.g. "Yes, I can work onsite 5 days"). */
export function pickDropdownOptionForAnswer(answer: string, optionTexts: string[]): string {
  const opts = optionTexts
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && !/^select an option$/i.test(o));
  if (!opts.length) return answer.trim();
  const a = answer.trim().toLowerCase();
  const exact = opts.find((o) => o.toLowerCase() === a);
  if (exact) return exact;
  if (a === "yes" || a === "no") {
    const prefix = opts.find((o) => {
      const ol = o.toLowerCase();
      return ol === a || ol.startsWith(`${a},`) || ol.startsWith(`${a} `);
    });
    if (prefix) return prefix;
    const contains = opts.find((o) => o.toLowerCase().includes(a));
    if (contains) return contains;
  }
  return matchAnswerToOption(answer, opts);
}

function pickOption(question: ApplyQuestionInput, preferred: string[]): string {
  const opts = (question.options ?? []).filter((o) => !/^select an option$/i.test(o.trim()));
  if (!opts.length) return preferred[0] ?? "";
  for (const p of preferred) {
    const hit = opts.find((o) => o.toLowerCase().includes(p.toLowerCase()));
    if (hit) return hit;
  }
  return opts[0];
}

function heuristicOfficeAttendance(
  question: ApplyQuestionInput,
  ctx: ApplyQuestionContext
): string | null {
  const label = question.label.toLowerCase();
  if (
    !/office|on.?site|in person|days per week|come into|hybrid|commute|relocat/i.test(label)
  ) {
    return null;
  }

  const loc = (ctx.profile.personal.location ?? "").toLowerCase();
  const resume = ctx.resumeText.toLowerCase();
  const counties = (ctx.profile.search?.counties ?? []).join(" ").toLowerCase();
  const inIreland =
    /ireland|\bie\b|dublin|cork|galway|limerick/i.test(loc) ||
    /ireland|dublin|cork|galway/i.test(resume) ||
    /cork|dublin|galway/i.test(counties);

  const corkQuestion = /cork/i.test(label);
  const nearCork =
    corkQuestion &&
    (/cork/i.test(loc) || /cork/i.test(resume) || /cork/i.test(counties) || inIreland);

  if (/able to come|come into|days per week|5 days|in the office|office in/i.test(label)) {
    const preferYes = nearCork || (!corkQuestion && inIreland);
    if (preferYes) {
      return pickOption(question, [
        "Yes",
        "5 days",
        "Fully",
        "On-site",
        "In the office",
        "I am able",
        "Available",
      ]);
    }
    return pickOption(question, ["No", "Not able", "Unable", "Prefer remote"]);
  }

  if (/hybrid|remote|work from home/i.test(label)) {
    return pickOption(question, ["Hybrid", "Yes", "Flexible", "Open to"]);
  }

  return pickOption(question, ["Yes", "No"]);
}

function heuristicYesNoAnswer(question: ApplyQuestionInput, ctx: ApplyQuestionContext): string | null {
  const label = question.label.toLowerCase();
  const loc = (ctx.profile.personal.location ?? "").toLowerCase();
  const resume = ctx.resumeText.toLowerCase();
  const inIreland =
    /ireland|\bie\b|dublin|cork|galway|limerick/i.test(loc) || /ireland|dublin|cork/i.test(resume);

  const office = heuristicOfficeAttendance(question, ctx);
  if (office) return office;

  if (/resident of dublin|resident in dublin/i.test(label)) {
    const inDublin =
      /dublin/i.test(loc) ||
      /dublin/i.test(resume) ||
      /dublin/i.test((ctx.profile.personal.location ?? "").toLowerCase());
    return matchAnswerToOption(inDublin ? "Yes" : "No", question.options ?? ["True", "False", "Yes", "No"]);
  }
  if (
    /located in ireland|currently in ireland|based in ireland|living in ireland|live in ireland/i.test(
      label
    )
  ) {
    return matchAnswerToOption(inIreland ? "Yes" : "No", question.options ?? ["True", "False", "Yes", "No"]);
  }
  if (
    /legally authorized|authorized to work|eligible to work|right to work|legal right to work/i.test(
      label
    )
  ) {
    return matchAnswerToOption("Yes", question.options ?? ["True", "False", "Yes", "No"]);
  }
  if (
    /require.*sponsorship|need.*sponsorship|visa sponsorship|employment visa/i.test(label)
  ) {
    return matchAnswerToOption("No", question.options ?? ["True", "False", "Yes", "No"]);
  }
  if (/currently on any type of visa|on any type of visa|hold a visa/i.test(label)) {
    return matchAnswerToOption("No", question.options ?? ["True", "False", "Yes", "No"]);
  }
  if (/have you worked|industries such as|insurtech|fintech|geospatial/i.test(label)) {
    const opts = (question.options ?? []).filter((o) => !/^select an option$/i.test(o));
    for (const opt of opts) {
      const key = opt.toLowerCase().slice(0, 12);
      if (key.length > 3 && (resume.includes(key) || key.includes("fintech") && resume.includes("finance"))) {
        return opt;
      }
    }
    return matchAnswerToOption(
      pickOption(question, ["No", "None", "Not applicable", "N/A", "No experience", "Other"]),
      question.options ?? ["No"]
    );
  }
  if (isYesNoQuestion(question.label, question.options)) {
    return matchAnswerToOption("Yes", question.options ?? ["Yes", "No"]);
  }
  return null;
}

/** Answer one or more application form questions using resume + job context. */
export async function generateApplyQuestionAnswers(
  questions: ApplyQuestionInput[],
  ctx: ApplyQuestionContext
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (questions.length === 0) return results;

  const provider = getAiProvider();
  if (provider === "local") {
    for (const q of questions) {
      results.set(q.label, heuristicApplyAnswer(q, ctx));
    }
    return results;
  }

  try {
    assertAiConfigured();
    const payload = questions.map((q) => ({
      question: q.label,
      field_type: q.fieldType,
      options: q.options?.length ? q.options : undefined,
    }));

    const content = await chatCompletionText({
      temperature: 0.2,
      system: `You fill job application forms honestly using ONLY the candidate's CV/resume.
Return valid JSON only: { "answers": [ { "question": "exact question text", "answer": "value" } ] }
Rules:
- For field_type "number" or any "experience with X" / "years of experience" question: answer a decimal number greater than 0 (e.g. 1.0, 2.5, 3.0). Default to 1.0 when the CV mentions the skill but not a year count. Default to 1.0 when unsure — never answer 0 unless the CV explicitly says no experience.
- For radio/select/combobox: answer must exactly match one of the provided options when options are given. For yes/no questions answer "Yes" or "No" (or the closest option text).
- "Are you currently located in Ireland?" → Yes if profile/CV shows Ireland; otherwise No.
- "Are you legally authorized to work in Ireland?" → Yes for EU/Ireland-based candidates unless CV says otherwise.
- Sponsorship questions → No / do not require sponsorship when candidate is in Ireland/EU.
- Multi-choice industry questions → pick the best matching option from the list using the CV, or "No"/"None" if no match.
- Never invent employers, degrees, or certifications not supported by the CV.
- For "What is your email/phone/full name" use the Profile values from the prompt — never answer "Yes" to contact fields.
- For "Add cover letter" use the cover letter excerpt.
- Keep text answers under 400 characters.`,
      user: `Role: ${ctx.jobTitle} at ${ctx.company}

Profile:
${profileSummary(ctx.profile)}

Job description (excerpt):
${ctx.jobDescription.slice(0, 3500)}

Resume / CV:
${ctx.resumeText.slice(0, 6000)}

Cover letter excerpt:
${ctx.coverLetter.slice(0, 1200)}

Questions to answer:
${JSON.stringify(payload, null, 2)}`,
    });

    const data = parseJsonFromLlm<{
      answers?: { question?: string; answer?: string }[];
    }>(content);

    for (const row of data.answers ?? []) {
      const q = row.question?.trim();
      const a = row.answer?.trim();
      if (!q || a == null) continue;
      const match = questions.find(
        (x) => x.label === q || x.label.includes(q) || q.includes(x.label.slice(0, 40))
      );
      const key = match?.label ?? q;
      let answer = a;
      if (match && isYearsExperienceQuestion(match.label, match.fieldType)) {
        answer = normalizeYearsExperienceAnswer(answer, match.label, match.fieldType);
      } else if (match?.fieldType === "number") {
        answer = clampNumber(answer, match.label, DEFAULT_YEARS_EXPERIENCE);
      } else if (
        match &&
        (match.fieldType === "select" ||
          match.fieldType === "combobox" ||
          match.fieldType === "radio") &&
        match.options?.length
      ) {
        answer = matchAnswerToOption(answer, match.options);
      }
      results.set(key, answer);
    }
  } catch (err) {
    console.warn("[ai] apply question batch failed, using heuristics:", err);
  }

  for (const q of questions) {
    if (!results.has(q.label)) {
      results.set(q.label, heuristicApplyAnswer(q, ctx));
    }
    if (isYearsExperienceQuestion(q.label, q.fieldType)) {
      results.set(
        q.label,
        normalizeYearsExperienceAnswer(results.get(q.label) ?? "", q.label, q.fieldType)
      );
    } else if (
      q.fieldType === "select" ||
      q.fieldType === "combobox" ||
      q.fieldType === "radio"
    ) {
      const raw = results.get(q.label) ?? "";
      const opts = q.options?.length ? q.options : ["Yes", "No"];
      results.set(q.label, matchAnswerToOption(raw, opts));
    }
  }

  return results;
}
