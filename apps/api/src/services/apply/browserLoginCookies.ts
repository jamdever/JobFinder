import fs from "node:fs";
import path from "node:path";
import { getBrowserProfileDir } from "./browserSession.js";

/** Chromium cookie DB paths (varies by Chrome version). */
export function findBrowserCookiesDb(): string | null {
  const base = getBrowserProfileDir();
  const candidates = [
    path.join(base, "Default", "Network", "Cookies"),
    path.join(base, "Default", "Cookies"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}

function cookieDbContains(...needles: string[]): boolean {
  const db = findBrowserCookiesDb();
  if (!db) return false;
  try {
    const buf = fs.readFileSync(db);
    return needles.every((n) => buf.includes(Buffer.from(n)));
  } catch {
    return false;
  }
}

/** LinkedIn session token — present when logged in to linkedin.com. */
export function hasLinkedInAuthCookieInProfile(): boolean {
  return cookieDbContains("li_at", "linkedin");
}

/** Indeed session — SOCK is set when signed in on indeed.com / ie.indeed.com. */
export function hasIndeedAuthCookieInProfile(): boolean {
  if (!cookieDbContains("indeed")) return false;
  return (
    cookieDbContains("indeed", "SOCK") ||
    cookieDbContains("indeed", "__Secure-PassportAuth") ||
    cookieDbContains("indeed", "INDEED_AUTH")
  );
}

/** Cloudflare clearance cookie saved in the apply browser profile. */
export function hasIndeedCloudflareAccessInProfile(): boolean {
  const db = findBrowserCookiesDb();
  if (!db) return false;
  try {
    const buf = fs.readFileSync(db);
    return buf.includes(Buffer.from("cf_clearance"));
  } catch {
    return false;
  }
}
