import PDFDocument from "pdfkit";
import { detectCvFormat, isJobHeaderLine } from "./ai/cvFormat.js";

/** Professional CV fonts (PDF built-ins; similar to Calibri/Times). */
const FONT = {
  body: "Times-Roman",
  bodyBold: "Times-Bold",
  bodyItalic: "Times-Italic",
  bodyBoldItalic: "Times-BoldItalic",
  sans: "Helvetica",
  sansBold: "Helvetica-Bold",
} as const;

const SIZE = {
  name: 16,
  contact: 9.5,
  section: 11,
  jobTitle: 10.5,
  body: 10.5,
  bullet: 10,
} as const;

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function isAllCapsSection(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 45) return false;
  if (!/^[A-Z][A-Z\s/&]+$/.test(t)) return false;
  return t === t.toUpperCase();
}

function isContactLine(line: string, lineIndex: number): boolean {
  return lineIndex > 0 && lineIndex < 4 && line.includes("|") && line.includes("@");
}

function isCompanyBlurb(line: string, prevWasJobHeader: boolean): boolean {
  if (!prevWasJobHeader) return false;
  const t = line.trim();
  if (!t || t.startsWith("•")) return false;
  if (isAllCapsSection(t) || isJobHeaderLine(t)) return false;
  if (/^[A-Za-z][^:]{0,35}:\s/.test(t)) return false;
  return /^[A-Z]/.test(t) && t.length < 220;
}

function isDegreeLine(line: string): boolean {
  return /Bachelor|Master|Honours|Honors|University|College|Graduated/i.test(line);
}

/** Convert tailored CV text to a printable A4 PDF. */
export function markdownCvToPdf(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 48, left: 52, right: 52 },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const format = detectCvFormat(markdown);
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    let prevWasJobHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      if (!trimmed) {
        doc.moveDown(0.3);
        prevWasJobHeader = false;
        continue;
      }

      if (trimmed === "---") {
        doc.moveDown(0.15);
        prevWasJobHeader = false;
        continue;
      }

      if (format === "plain_caps" && i === 0 && !isAllCapsSection(trimmed)) {
        doc.font(FONT.bodyBold).fontSize(SIZE.name).fillColor("#000000");
        doc.text(trimmed, { width: pageWidth, align: "center" });
        prevWasJobHeader = false;
        continue;
      }

      if (format === "plain_caps" && isContactLine(trimmed, i)) {
        doc.font(FONT.sans).fontSize(SIZE.contact).fillColor("#444444");
        doc.text(trimmed, { width: pageWidth, align: "center" });
        prevWasJobHeader = false;
        continue;
      }

      if (format === "plain_caps" && isAllCapsSection(trimmed)) {
        doc.moveDown(0.4);
        doc.font(FONT.bodyBold).fontSize(SIZE.section).fillColor("#000000");
        doc.text(trimmed, { width: pageWidth });
        prevWasJobHeader = false;
        continue;
      }

      const h2 = trimmed.match(/^##\s+(.+)/);
      if (h2) {
        doc.moveDown(0.45);
        doc.font(FONT.bodyBold).fontSize(SIZE.section).fillColor("#000000");
        doc.text(stripMarkdownInline(h2[1]).toUpperCase(), { width: pageWidth });
        prevWasJobHeader = false;
        continue;
      }

      const h3 = trimmed.match(/^###\s+(.+)/);
      if (h3) {
        doc.moveDown(0.3);
        doc.font(FONT.bodyBold).fontSize(SIZE.jobTitle).fillColor("#111111");
        doc.text(stripMarkdownInline(h3[1]), { width: pageWidth });
        prevWasJobHeader = true;
        continue;
      }

      const roundBullet = trimmed.match(/^[•\u2022]\s+(.+)/);
      if (roundBullet) {
        doc.font(FONT.body).fontSize(SIZE.bullet).fillColor("#222222");
        doc.text(`• ${stripMarkdownInline(roundBullet[1])}`, {
          width: pageWidth,
          indent: 14,
          paragraphGap: 1.5,
          lineGap: 1,
        });
        prevWasJobHeader = false;
        continue;
      }

      const bullet = trimmed.match(/^[\*\-]\s+(.+)/);
      if (bullet) {
        doc.font(FONT.body).fontSize(SIZE.bullet).fillColor("#222222");
        doc.text(`• ${stripMarkdownInline(bullet[1])}`, {
          width: pageWidth,
          indent: 14,
          paragraphGap: 1.5,
          lineGap: 1,
        });
        prevWasJobHeader = false;
        continue;
      }

      if (/^[A-Za-z][^:]{0,35}:\s/.test(trimmed) && !trimmed.startsWith("•")) {
        doc.font(FONT.bodyBold).fontSize(SIZE.body).fillColor("#222222");
        doc.text(stripMarkdownInline(trimmed), { width: pageWidth, lineGap: 1 });
        prevWasJobHeader = false;
        continue;
      }

      if (isJobHeaderLine(trimmed) || (format === "plain_caps" && / — .+\|/.test(trimmed))) {
        doc.moveDown(0.22);
        doc.font(FONT.bodyBold).fontSize(SIZE.jobTitle).fillColor("#000000");
        doc.text(stripMarkdownInline(trimmed), { width: pageWidth, lineGap: 0.5 });
        prevWasJobHeader = true;
        continue;
      }

      if (isCompanyBlurb(trimmed, prevWasJobHeader)) {
        doc.font(FONT.bodyItalic).fontSize(SIZE.body).fillColor("#333333");
        doc.text(stripMarkdownInline(trimmed), { width: pageWidth, lineGap: 1 });
        prevWasJobHeader = false;
        continue;
      }

      if (isDegreeLine(trimmed)) {
        doc.font(FONT.bodyItalic).fontSize(SIZE.body).fillColor("#222222");
        doc.text(stripMarkdownInline(trimmed), { width: pageWidth, lineGap: 1 });
        prevWasJobHeader = false;
        continue;
      }

      doc.font(FONT.body).fontSize(SIZE.body).fillColor("#222222");
      doc.text(stripMarkdownInline(trimmed), {
        width: pageWidth,
        paragraphGap: 2,
        lineGap: 1.5,
        align: "left",
      });
      prevWasJobHeader = false;
    }

    doc.end();
  });
}

export function safePdfFilename(title: string, company: string): string {
  const base = `CV-tailored-${title}-${company}`
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `${base}.pdf`;
}
