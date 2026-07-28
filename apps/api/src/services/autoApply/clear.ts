import { AutoApplyLogModel } from "../../models/AutoApplyLog.js";
import { JobModel } from "../../models/Job.js";
import { resetAutoApplyWatchRuntime } from "./watch.js";

export async function clearAutoApplyData(): Promise<{
  logsRemoved: number;
  jobsRemoved: number;
}> {
  const logResult = await AutoApplyLogModel.deleteMany({
    jobUrl: { $regex: /linkedin\.com/i },
  });

  const jobResult = await JobModel.deleteMany({
    source: "linkedin",
    linkedInApplyType: "easy_apply",
    status: { $ne: "applied" },
  });

  resetAutoApplyWatchRuntime();

  return {
    logsRemoved: logResult.deletedCount,
    jobsRemoved: jobResult.deletedCount,
  };
}
