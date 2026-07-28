import OpenAI from "openai";
import { assertOpenAiConfigured, env } from "../../config.js";

export type AiProvider = "openai" | "ollama" | "local";

export function getAiProvider(): AiProvider {
  const p = env.aiProvider.toLowerCase();
  if (p === "ollama" || p === "local") return p;
  return "openai";
}

export function getAiModelLabel(): string {
  const provider = getAiProvider();
  if (provider === "local") return "local-keywords";
  if (provider === "ollama") return `ollama:${env.ollamaModel}`;
  return env.openaiModel;
}

export function assertAiConfigured(): void {
  const provider = getAiProvider();
  if (provider === "local") return;
  if (provider === "ollama") return;
  assertOpenAiConfigured();
}

export async function assertOllamaReachable(): Promise<void> {
  const base = env.ollamaBaseUrl.replace(/\/$/, "");
  const want = env.ollamaModel;
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = data.models?.map((m) => m.name) ?? [];
    const has = names.some((n) => n === want || n.startsWith(`${want}:`));
    if (!has) {
      throw new Error(
        `Model "${want}" is not installed. Run: ollama pull ${want}` +
          (names.length ? ` (you have: ${names.slice(0, 4).join(", ")})` : "")
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not installed")) throw err;
    throw new Error(
      `Ollama is not running at ${env.ollamaBaseUrl}. Open the Ollama app or run "ollama serve", then "ollama pull ${want}".`
    );
  }
}

function getChatClient(): OpenAI {
  const provider = getAiProvider();
  if (provider === "ollama") {
    return new OpenAI({
      baseURL: `${env.ollamaBaseUrl.replace(/\/$/, "")}/v1`,
      apiKey: "ollama",
    });
  }
  assertOpenAiConfigured();
  return new OpenAI({ apiKey: env.openaiApiKey });
}

function activeChatModel(): string {
  return getAiProvider() === "ollama" ? env.ollamaModel : env.openaiModel;
}

/** Chat completion that returns raw message text (JSON expected in prompt). */
export async function chatCompletionText(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const provider = getAiProvider();
  if (provider === "local") {
    throw new Error("Local provider does not use cloud/LLM chat");
  }
  if (provider === "ollama") await assertOllamaReachable();

  const client = getChatClient();
  const model = activeChatModel();
  const useJsonFormat = provider === "openai";

  const response = await client.chat.completions.create({
    model,
    temperature: params.temperature ?? 0.25,
    ...(useJsonFormat ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error(`${getAiModelLabel()} returned an empty response`);
  }

  console.log(`[ai] ${getAiModelLabel()} completed request`);
  return content;
}

export function parseJsonFromLlm<T>(content: string): T {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error("Could not parse JSON from AI response");
  }
}
