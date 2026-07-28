import { deriveJobMetadata } from "@jobfinder/shared";
import type { JobListingInput } from "@jobfinder/shared";

export function metadataFromListing(listing: JobListingInput) {
  const meta = deriveJobMetadata({
    id: "",
    externalId: listing.externalId,
    source: listing.source,
    title: listing.title,
    company: listing.company,
    location: listing.location ?? "",
    url: listing.url,
    description: listing.description ?? "",
    tags: listing.tags ?? [],
    salary: listing.salary ?? "",
    matchScore: 0,
    status: "discovered",
    discoveredAt: new Date().toISOString(),
  });
  return meta;
}
