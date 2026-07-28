/**
 * Run a dry-run Easy Apply for one job. Usage:
 *   node scripts/run-dry-apply.mjs <jobId>
 */
const jobId = process.argv[2] ?? "6a0b70650a154559f7319f63";
const base = process.env.API_URL ?? "http://localhost:4000";

const res = await fetch(`${base}/api/autoapply/run/${jobId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ dryRun: true, headless: false, skipAnalyze: true, skipTailor: true }),
});

const body = await res.json().catch(() => ({}));
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);
