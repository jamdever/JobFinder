/** Republic of Ireland counties (search + display). */
export const IRELAND_COUNTIES = [
  "Carlow",
  "Cavan",
  "Clare",
  "Cork",
  "Donegal",
  "Dublin",
  "Galway",
  "Kerry",
  "Kildare",
  "Kilkenny",
  "Laois",
  "Leitrim",
  "Limerick",
  "Longford",
  "Louth",
  "Mayo",
  "Meath",
  "Monaghan",
  "Offaly",
  "Roscommon",
  "Sligo",
  "Tipperary",
  "Waterford",
  "Westmeath",
  "Wexford",
  "Wicklow",
] as const;

export type IrelandCounty = (typeof IRELAND_COUNTIES)[number];

export const DEFAULT_SEARCH_COUNTRY = "Ireland";

export function normalizeCounty(raw: string | undefined): string {
  const c = raw?.trim() ?? "";
  if (!c || /^all$/i.test(c)) return "";
  const match = IRELAND_COUNTIES.find((name) => name.toLowerCase() === c.toLowerCase());
  return match ?? c;
}

/** Unique normalized counties from profile fields (supports legacy single `county`). */
export function getSearchCounties(
  counties?: string[],
  legacyCounty?: string
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const sources = [...(counties ?? [])];
  if (legacyCounty?.trim()) sources.push(legacyCounty);
  for (const raw of sources) {
    const c = normalizeCounty(raw);
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Label for UI, e.g. "Dublin · Westmeath, Ireland" or "Ireland (all counties)". */
export function formatSearchLocationsLabel(country: string, counties: string[]): string {
  const countryLabel = country.trim() || DEFAULT_SEARCH_COUNTRY;
  const list = getSearchCounties(counties);
  if (list.length === 0) return `${countryLabel} (all counties)`;
  if (list.length <= 4) return `${list.join(" · ")}, ${countryLabel}`;
  return `${list.length} counties, ${countryLabel}`;
}

/** Indeed / LinkedIn location query string for one county. */
export function getBoardSearchLocation(country: string, county?: string): string {
  const c = normalizeCounty(county);
  const countryLabel = country.trim() || DEFAULT_SEARCH_COUNTRY;
  if (!c) return countryLabel;
  return `${c}, ${countryLabel}`;
}

/** Stored on profile.preferences.locations for scoring. */
export function buildPreferenceLocations(country: string, counties: string[]): string[] {
  const list = getSearchCounties(counties);
  const countryLabel = country.trim() || DEFAULT_SEARCH_COUNTRY;
  if (list.length === 0) return [countryLabel];
  const set = new Set<string>([countryLabel]);
  for (const c of list) {
    set.add(c);
    set.add(`${c}, ${countryLabel}`);
  }
  return [...set];
}

/** Towns often shown without county on job boards — mapped to county for filtering. */
const IRELAND_TOWN_TO_COUNTY: Record<string, string> = {
  athlone: "Westmeath",
  mullingar: "Westmeath",
  tullamore: "Offaly",
  portlaoise: "Laois",
  kilkenny: "Kilkenny",
  waterford: "Waterford",
  wexford: "Wexford",
  dundalk: "Louth",
  drogheda: "Louth",
  sligo: "Sligo",
  letterkenny: "Donegal",
  ennis: "Clare",
  tralee: "Kerry",
  killarney: "Kerry",
  navan: "Meath",
  trim: "Meath",
  naas: "Kildare",
  maynooth: "Kildare",
  carlow: "Carlow",
  cavan: "Cavan",
  monaghan: "Monaghan",
  ballina: "Mayo",
  castlebar: "Mayo",
  roscommon: "Roscommon",
  longford: "Longford",
};

function locIncludesCounty(loc: string, county: string): boolean {
  const countyLower = county.toLowerCase();
  if (
    loc.includes(countyLower) ||
    loc.includes(`co. ${countyLower}`) ||
    loc.includes(`county ${countyLower}`) ||
    loc.includes(`${countyLower} county`)
  ) {
    return true;
  }
  for (const [town, mappedCounty] of Object.entries(IRELAND_TOWN_TO_COUNTY)) {
    if (mappedCounty.toLowerCase() === countyLower && new RegExp(`\\b${town}\\b`, "i").test(loc)) {
      return true;
    }
  }
  return false;
}

function locMentionsCountyOutsideSet(loc: string, allowed: string[]): boolean {
  const allowedLower = new Set(allowed.map((c) => c.toLowerCase()));
  for (const name of IRELAND_COUNTIES) {
    if (!locIncludesCounty(loc, name)) continue;
    if (!allowedLower.has(name.toLowerCase())) return true;
  }
  return false;
}

export type CountyMatchMode =
  /** Dashboard / stored-job list — must mention a selected county (or a mapped town). */
  | "strict"
  /** After a county-scoped board search — drop other counties; allow Ireland-wide remote. */
  | "board";

/** True when a job location fits any selected county (or no county filter). */
export function jobLocationMatchesSearchCounties(
  counties: string[],
  location: string | undefined,
  mode: CountyMatchMode = "strict"
): boolean {
  const selected = getSearchCounties(counties);
  if (selected.length === 0) return true;

  const loc = (location ?? "").trim().toLowerCase();
  if (!loc) return mode === "board";

  if (locMentionsCountyOutsideSet(loc, selected)) {
    return false;
  }

  if (selected.some((c) => locIncludesCounty(loc, c))) {
    return true;
  }

  if (mode === "board") {
    if (/^ireland$/i.test(loc.trim())) return true;
    if (/\bremote\b/.test(loc)) return true;
    if (/\bhybrid\b/.test(loc)) return true;
  }

  return false;
}
