import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

config({ path: path.join(root, ".env") });
config({ path: path.resolve(process.cwd(), ".env") });

export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/jobfinder",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  /** openai | ollama (free, local) | local (free, keyword-only) */
  aiProvider: process.env.AI_PROVIDER ?? "openai",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3:8b",
  adzunaAppId: process.env.ADZUNA_APP_ID ?? "",
  adzunaAppKey: process.env.ADZUNA_APP_KEY ?? "",
  /** Adzuna country code (ie not supported — use Playwright for Indeed Ireland) */
  adzunaCountry: process.env.ADZUNA_COUNTRY ?? "ie",
  /** Max parallel county/board fetches during collect (default 6). */
  collectConcurrency: Math.min(Math.max(Number(process.env.COLLECT_CONCURRENCY ?? 6), 1), 10),
  /** Fetch full Indeed descriptions during collect (slow). Default off — load on expand. */
  collectIndeedDescriptions:
    process.env.COLLECT_INDEED_DESCRIPTIONS === "1" ||
    process.env.COLLECT_INDEED_DESCRIPTIONS === "true",
  /** Max parallel LinkedIn title searches (default 3). Higher = faster, more detection risk. */
  linkedInCollectConcurrency: Math.min(
    Math.max(Number(process.env.LINKEDIN_COLLECT_CONCURRENCY ?? 3), 1),
    6
  ),
  /** Parallel AI analyses during Find jobs (default 2; use 1 for Ollama on weak hardware). */
  analyzeConcurrency: Math.min(Math.max(Number(process.env.ANALYZE_CONCURRENCY ?? 2), 1), 5),
  /**
   * Indeed Ireland needs a real browser (Adzuna has no IE feed; HTML scrape often 403).
   * On by default. Set COLLECT_INDEED_PLAYWRIGHT=0 to skip for faster collects.
   */
  indeedUsePlaywright:
    process.env.COLLECT_INDEED_PLAYWRIGHT !== "0" &&
    process.env.COLLECT_INDEED_PLAYWRIGHT !== "false",
  projectRoot: root,
  configDir: path.join(root, "config"),
  resumesDir: path.join(root, "resumes"),
  uploadsDir: path.join(root, "data", "applications"),
  /** Optional — automatic Cloudflare Turnstile solving (https://capsolver.com) */
  capsolverApiKey: process.env.CAPSOLVER_API_KEY ?? "",
  /** Optional — alternative Turnstile solver (https://2captcha.com) */
  twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY ?? "",
};

export function ensureDirs(): void {
  fs.mkdirSync(env.resumesDir, { recursive: true });
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  fs.mkdirSync(env.configDir, { recursive: true });
}

export function assertOpenAiConfigured(): void {
  const key = env.openaiApiKey.trim();
  if (!key || key === "sk-..." || key.length < 20) {
    throw new Error(
      "OPENAI_API_KEY is missing or invalid. Add your key to .env and restart the API."
    );
  }
}
