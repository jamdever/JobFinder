/** Extract text from a PDF buffer; suppresses noisy pdf.js TrueType font warnings. */
export async function parsePdfText(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const previousWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    const msg = typeof first === "string" ? first : String(first ?? "");
    if (msg.includes("Warning: TT:")) return;
    previousWarn.apply(console, args as Parameters<typeof console.warn>);
  };
  try {
    const data = await pdfParse(buffer);
    return data.text.trim();
  } finally {
    console.warn = previousWarn;
  }
}
