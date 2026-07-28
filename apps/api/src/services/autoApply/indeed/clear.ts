import { AutoApplyLogModel } from "../../../models/AutoApplyLog.js";
import { JobModel } from "../../../models/Job.js";
import { resetIndeedAutoApplyWatchRuntime } from "./watch.js";

export async function clearIndeedAutoApplyData(): Promise<{
  logsRemoved: number;
  jobsRemoved: number;
}> {
  const logResult = await AutoApplyLogModel.deleteMany({
    jobUrl: { $regex: /indeed\.com/i },
  });

  const jobResult = await JobModel.deleteMany({
    source: "indeed",
    indeedApplyType: "easy_apply",
    status: { $ne: "applied" },
  });

  resetIndeedAutoApplyWatchRuntime();

  return {
    logsRemoved: logResult.deletedCount,
    jobsRemoved: jobResult.deletedCount,
  };
}
