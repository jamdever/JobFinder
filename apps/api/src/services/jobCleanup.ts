import { JobModel } from "../models/Job.js";
import type { UserProfile } from "@jobfinder/shared";
import { matchesAnyTargetTitle } from "./matching.js";
import { getSearchCountiesFromProfile, getSearchTitles, jobMatchesSearchArea } from "./search/utils.js";
import { formatSearchLocationsLabel } from "@jobfinder/shared";

/** Remove stored jobs that no longer match search titles or selected county. */
export async function cleanupIrrelevantJobs(profile: UserProfile): Promise<number> {
  const targets = getSearchTitles(profile);
  if (!targets.length) return 0;

  const docs = await JobModel.find({}).select("title location");
  const idsToDelete = docs
    .filter(
      (doc) =>
        !matchesAnyTargetTitle(profile, doc.title) ||
        !jobMatchesSearchArea(profile, doc.location)
    )
    .map((doc) => doc._id);

  if (idsToDelete.length === 0) return 0;

  const result = await JobModel.deleteMany({ _id: { $in: idsToDelete } });
  const area = formatSearchLocationsLabel(
    profile.search.country ?? "Ireland",
    getSearchCountiesFromProfile(profile)
  );
  console.log(
    `[cleanup] removed ${result.deletedCount} jobs not matching titles (${targets.join(" | ")}) in ${area}`
  );
  return result.deletedCount ?? 0;
}
