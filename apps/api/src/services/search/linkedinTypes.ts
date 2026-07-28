import type { JobListingInput } from "@jobfinder/shared";

export type LinkedInFetchResult = {
  jobs: JobListingInput[];
  warning?: string;
  externalUrls?: string[];
};

export type LinkedInSearchOptions = { easyApplyOnly?: boolean };
