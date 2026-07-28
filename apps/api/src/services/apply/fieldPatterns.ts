/** Maps profile / screening keys to form field label patterns. */
export const FIELD_PATTERNS: Record<string, RegExp[]> = {
  fullName: [/full.?name/i, /^name$/i, /your.?name/i, /applicant.?name/i, /first.?and.?last/i],
  firstName: [/first.?name/i, /given.?name/i],
  lastName: [/last.?name/i, /surname/i, /family.?name/i],
  email: [/e.?mail/i, /email.?address/i],
  phone: [/phone/i, /mobile/i, /telephone/i, /contact.?number/i],
  linkedin: [/linkedin/i],
  portfolio: [/portfolio/i, /personal.?site/i, /website/i],
  github: [/github/i],
  location: [/location/i, /city/i, /where.?are.?you/i, /address/i],
  coverLetter: [
    /cover.?letter/i,
    /add cover/i,
    /^message$/i,
    /why.?interested/i,
    /additional.?information/i,
    /comments/i,
    /tell us about yourself/i,
  ],
};

export function matchFieldKeyFromLabel(labelText: string): string | null {
  return matchFieldKey({
    name: "",
    id: "",
    placeholder: "",
    label: labelText,
    aria: labelText,
  });
}

export const SCREENING_PATTERNS: Record<string, RegExp[]> = {
  why_this_role: [
    /why.*(?:role|position|company|join|apply)/i,
    /what interests you/i,
    /motivation/i,
  ],
  years_experience: [
    /commercial experience as a software/i,
    /years of commercial experience/i,
    /years.*experience/i,
    /how many years/i,
    /experience level/i,
    /what is your experience/i,
    /experience with/i,
  ],
  work_authorization: [
    /authorized.*work/i,
    /legally.*eligible/i,
    /legally authorized/i,
    /work permit/i,
    /right to work/i,
    /legal right to work/i,
    /live and have the legal right to work/i,
  ],
  located_ireland: [
    /located in ireland/i,
    /currently in ireland/i,
    /based in ireland/i,
    /living in ireland/i,
    /live in ireland/i,
  ],
  dublin_resident: [/resident of dublin/i, /resident in dublin/i, /live in dublin/i],
  industry_experience: [
    /industries such as/i,
    /insurtech/i,
    /fintech/i,
    /geospatial/i,
    /catastrophe modeling/i,
  ],
  sponsorship: [
    /require.*sponsorship/i,
    /visa sponsorship/i,
    /need.*sponsorship/i,
    /employment visa status/i,
    /visa status/i,
    /currently on any type of visa/i,
    /on any type of visa/i,
  ],
  salary: [/salary/i, /compensation/i, /pay expectation/i, /desired pay/i],
  notice_period: [/notice period/i, /start date/i, /availability/i, /when can you start/i],
  office_attendance: [
    /come into the office/i,
    /days per week/i,
    /able to come/i,
    /work in the office/i,
    /office in cork/i,
    /on.?site/i,
  ],
};

export function matchFieldKey(meta: {
  name: string;
  id: string;
  placeholder: string;
  label: string;
  aria: string;
}): string | null {
  const haystack = [meta.name, meta.id, meta.placeholder, meta.label, meta.aria]
    .join(" ")
    .toLowerCase();
  for (const [key, patterns] of Object.entries(FIELD_PATTERNS)) {
    if (patterns.some((p) => p.test(haystack))) return key;
  }
  return null;
}

export function matchScreeningKey(labelText: string): string | null {
  const hay = labelText.toLowerCase();
  for (const [key, patterns] of Object.entries(SCREENING_PATTERNS)) {
    if (patterns.some((p) => p.test(hay))) return key;
  }
  return null;
}
