/** How closely a job listing title matches the user's target role (0–1). */

const SENIOR_OR_STAFF =
  /\b(senior|sr\.?|principal|staff|lead|head of|director|manager|architect|chief|vp|vice president|consultant|specialist iii|specialist iv|level iii|level iv)\b/i;

const JUNIOR_MARKERS =
  /\b(junior|jr\.?|graduate|grad|entry[- ]?level|intern|internship|trainee|associate|apprentice|early career)\b/i;

/** Job title must mention software for software-developer searches */
const SOFTWARE_IN_TITLE = /\bsoftware\b/i;

const SOFTWARE_DEV_TITLE =
  /\b(software\s+(developer|engineer|programmer)|full[- ]?stack\s+(developer|engineer)|backend\s+developer|frontend\s+developer|front[- ]?end\s+developer|web\s+developer|devops\s+engineer|junior\s+developer|graduate\s+developer|entry[- ]?level\s+developer)\b/i;

/** Listing looks like a software/dev role (not every job with "developer" in the title). */
function isSoftwareDevJobTitle(jobTitle: string): boolean {
  if (SOFTWARE_IN_TITLE.test(jobTitle)) return true;
  if (SOFTWARE_DEV_TITLE.test(jobTitle)) return true;
  if (/\b(developer|engineer|programmer)\b/i.test(jobTitle) && JUNIOR_MARKERS.test(jobTitle)) {
    return true;
  }
  return /\bsoftware\b.*\b(developer|engineer|programmer)\b/i.test(jobTitle);
}

const BLOCKED_TITLE =
  /\b(cad\/cam|\berp\b|environmental health|safety engineer|application engineer|business application|power platform|product design|design quality|drug product|\bmsat\b|technical service|service engineer|quality engineer|manufacturing engineer|process engineer|civil engineer|mechanical engineer|electrical engineer|structural engineer|field engineer|hardware engineer|network engineer|systems engineer|data engineer|cloud engineer|platform engineer|sales|marketing|recruiter|nurse|driver|chef|technician|operator|analyst\b(?!.*software))/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+.#/ -]+/g, " ").replace(/\s+/g, " ").trim();
}

export function targetIsJunior(target: string): boolean {
  return /\bjunior\b|\bgraduate\b|\bentry\b|\bintern\b/i.test(target);
}

export function isSeniorOrStaffJobTitle(jobTitle: string): boolean {
  return SENIOR_OR_STAFF.test(jobTitle) && !JUNIOR_MARKERS.test(jobTitle);
}

function targetIsSoftwareDeveloper(target: string): boolean {
  return /\bsoftware\b/i.test(target) && /\b(developer|engineer|programmer)\b/i.test(target);
}

function wordOverlap(target: string, jobTitle: string): number {
  const stop = new Set(["and", "the", "for", "with", "or"]);
  const words = norm(target)
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w));
  if (!words.length) return 0;
  const j = norm(jobTitle);
  const hits = words.filter((w) => j.includes(w)).length;
  return hits / words.length;
}

export function scoreTitleRelevance(targetTitle: string, jobTitle: string): number {
  const target = norm(targetTitle);
  const job = norm(jobTitle);
  if (!target || !job || job.length < 4) return 0;

  if (BLOCKED_TITLE.test(job)) return 0;

  if (targetIsSoftwareDeveloper(target) && !isSoftwareDevJobTitle(jobTitle)) {
    return 0;
  }

  if (targetIsJunior(target) && SENIOR_OR_STAFF.test(job) && !JUNIOR_MARKERS.test(job)) {
    return 0;
  }

  if (job === target || job.includes(target)) return 1;

  if (target.includes(job) && job.length >= target.length * 0.85) return 1;

  if (target.includes(job) && targetIsJunior(target) && !JUNIOR_MARKERS.test(job)) {
    return 0.45;
  }

  const overlap = wordOverlap(target, job);
  if (targetIsSoftwareDeveloper(target) && !isSoftwareDevJobTitle(jobTitle)) return 0;

  let score = 0.35 + overlap * 0.35;

  if (isSoftwareDevJobTitle(jobTitle)) {
    score += 0.25;
  }
  if (/\bsoftware\s+developer\b/.test(job)) {
    score += 0.12;
  }

  if (targetIsJunior(target)) {
    if (JUNIOR_MARKERS.test(job)) score += 0.25;
    else if (!SENIOR_OR_STAFF.test(job) && /\bsoftware developer\b/.test(job)) {
      score += 0.05;
    } else if (!JUNIOR_MARKERS.test(job)) {
      score -= 0.2;
    }
  }

  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

export function isRelevantJobTitle(
  targetTitle: string,
  jobTitle: string,
  minScore = 0.55
): boolean {
  return scoreTitleRelevance(targetTitle, jobTitle) >= minScore;
}
