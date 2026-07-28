/** User-facing message for OpenAI SDK / API failures */
export function formatOpenAiError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;

  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";

  const text = `${raw} ${code} ${status ?? ""}`.toLowerCase();

  if (
    status === 429 ||
    text.includes("429") ||
    text.includes("quota") ||
    text.includes("billing") ||
    text.includes("insufficient_quota")
  ) {
    return (
      "OpenAI quota exceeded — your account has no credits or hit its usage limit. " +
      "Add billing at https://platform.openai.com/account/billing then try again."
    );
  }

  if (
    status === 401 ||
    text.includes("invalid_api_key") ||
    text.includes("incorrect api key")
  ) {
    return (
      "OpenAI API key is invalid. Update OPENAI_API_KEY in your .env file and restart the API."
    );
  }

  if (status === 403 || text.includes("model_not_found")) {
    return `OpenAI rejected the request (${raw}). Check OPENAI_MODEL in .env.`;
  }

  if (
    text.includes("econnrefused") ||
    text.includes("fetch failed") ||
    text.includes("ollama is not running")
  ) {
    return (
      "Cannot reach Ollama. Install from https://ollama.com, run " +
      '"ollama pull llama3.2" and "ollama serve", or set AI_PROVIDER=local in .env for free keyword matching.'
    );
  }

  return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
}
