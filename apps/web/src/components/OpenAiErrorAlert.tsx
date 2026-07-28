import { isOpenAiQuotaError, openAiQuotaHelp } from "@/lib/openaiErrors";

export function OpenAiErrorAlert({ message }: { message: string }) {
  if (!message) return null;

  if (isOpenAiQuotaError(message)) {
    const help = openAiQuotaHelp();
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
        <p className="font-medium text-amber-200">{help.title}</p>
        <p className="mt-2 text-amber-100/90">
          The app reached OpenAI correctly, but your account rejected the request (HTTP 429 — quota
          exceeded). AI matching and CV tailoring both need active billing.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-amber-100/80">
          {help.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-3">
          <a
            href="https://platform.openai.com/account/billing"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Open OpenAI billing →
          </a>
        </p>
      </div>
    );
  }

  return (
    <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}
