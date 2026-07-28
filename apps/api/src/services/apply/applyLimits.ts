import { AutoApplyLogModel } from "../../models/AutoApplyLog.js";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Live LinkedIn submissions today — dry runs never count toward the daily cap. */
export async function countLiveApplicationsToday(): Promise<number> {
  return AutoApplyLogModel.countDocuments({
    dryRun: false,
    createdAt: { $gte: startOfToday() },
    $or: [
      { submitted: true },
      { message: /application submitted|submitted via linkedin/i },
    ],
  });
}
