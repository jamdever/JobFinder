import { connectDb } from "../src/db.js";
import { JobModel } from "../src/models/Job.js";
import { runIndeedEasyApplyPipeline } from "../src/services/autoApply/indeed/pipeline.js";

const jk = process.argv[2] ?? "dd0a0fda636a2adc";

await connectDb();

const doc =
  (await JobModel.findOne({
    source: "indeed",
    $or: [{ externalId: jk }, { url: { $regex: jk } }],
    indeedApplyType: "easy_apply",
  })) ??
  (await JobModel.findOne({
    source: "indeed",
    $or: [{ externalId: jk }, { url: { $regex: jk } }],
  }));

if (!doc) {
  console.error("No Indeed job found for jk:", jk);
  process.exit(1);
}

console.log("Running dry run:", doc.title, String(doc._id));

const result = await runIndeedEasyApplyPipeline({
  jobId: String(doc._id),
  dryRun: true,
  headless: false,
});

console.log("\n--- Result ---");
console.log("status:", result.status);
console.log("message:", result.message);
console.log("submitted:", result.submitted);
if (result.automation?.warnings?.length) {
  console.log("warnings:", result.automation.warnings.join("\n  "));
}
if (result.automation?.steps?.length) {
  console.log(
    "steps:",
    result.automation.steps.map((s) => s.action + (s.detail ? ` (${s.detail})` : "")).join(" → ")
  );
}
console.log("screenshots:", result.automation?.screenshotDir ?? "(none)");
const smartDetail = result.automation?.steps?.find((s) =>
  String(s.detail ?? "").includes("indeed_smartapply")
)?.detail;
if (smartDetail) console.log("smart apply:", smartDetail);
if (result.automation?.warnings?.length) {
  console.log("needsManualReview:", result.automation.needsManualReview);
}

process.exit(0);
