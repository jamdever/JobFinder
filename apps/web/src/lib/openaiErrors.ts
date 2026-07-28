export function isOpenAiQuotaError(message: string): boolean {
  const t = message.toLowerCase();
  return (
    t.includes("429") ||
    t.includes("quota") ||
    t.includes("billing") ||
    t.includes("insufficient_quota")
  );
}

export function openAiQuotaHelp(): { title: string; steps: string[] } {
  return {
    title: "OpenAI billing required",
    steps: [
      "Open platform.openai.com/account/billing and add a payment method or prepaid credits.",
      "Check Usage for limits: platform.openai.com/usage",
      "Restart the app (npm run dev:clean), then try again.",
    ],
  };
}
