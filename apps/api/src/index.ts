import cors from "cors";
import express from "express";
import { env } from "./config.js";
import { connectDb } from "./db.js";
import { jobsRouter } from "./routes/jobs.js";
import { applicationsRouter } from "./routes/applications.js";
import { matcherRouter } from "./routes/matcher.js";
import { profileRouter } from "./routes/profile.js";
import { autoApplyRouter } from "./routes/autoapply.js";
import { autoApplyIndeedRouter } from "./routes/autoapplyIndeed.js";

const app = express();

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/profile", profileRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/matcher", matcherRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/autoapply", autoApplyRouter);
app.use("/api/autoapply-indeed", autoApplyIndeedRouter);

async function main() {
  await connectDb();
  const { resumeAutoApplyWatchIfEnabled } = await import("./services/autoApply/watch.js");
  const { resumeIndeedAutoApplyWatchIfEnabled } = await import(
    "./services/autoApply/indeed/watch.js"
  );
  void resumeAutoApplyWatchIfEnabled();
  void resumeIndeedAutoApplyWatchIfEnabled();
  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${env.port} is already in use. Stop the other process or change API_PORT in .env`);
      process.exit(1);
    }
    throw err;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
