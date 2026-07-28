/**
 * Verifies Ollama is running and the configured model is installed.
 * Usage: node scripts/ollama-check.js
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

const base = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL ?? "llama3:8b";
const provider = (process.env.AI_PROVIDER ?? "ollama").toLowerCase();

console.log(`AI_PROVIDER=${provider}`);
console.log(`OLLAMA_BASE_URL=${base}`);
console.log(`OLLAMA_MODEL=${model}`);

if (provider !== "ollama") {
  console.log("\nTip: set AI_PROVIDER=ollama in .env to use your local Ollama models.");
  process.exit(0);
}

try {
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const names = (data.models ?? []).map((m) => m.name);
  console.log(`\nOllama OK — ${names.length} model(s) installed:`);
  for (const n of names) console.log(`  - ${n}`);

  const has = names.some((n) => n === model || n.startsWith(`${model}:`));
  if (!has) {
    console.error(`\nModel "${model}" not found. Pull it with:\n  ollama pull ${model}`);
    process.exit(1);
  }
  console.log(`\nConfigured model "${model}" is ready for JobFinder.`);
} catch (err) {
  console.error("\nCannot reach Ollama:", err.message);
  console.error("Start the Ollama app or run: ollama serve");
  process.exit(1);
}
