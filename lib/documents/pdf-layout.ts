import "server-only";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts } from "pdf-lib";
import { A4_SIZE, documentTheme } from "./theme";

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = text.replaceAll("\r", "").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export class DocumentPdfLayout {
  private readonly pdf: PDFDocument;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;
  private readonly logo: PDFImage;
  private readonly clinicName: string;
  private readonly clinicTagline: string;
  private pages: PDFPage[] = [];
  private page!: PDFPage;
  private cursorY = documentTheme.topContentY;

  private constructor(input: {
    pdf: PDFDocument;
    regular: PDFFont;
    bold: PDFFont;
    logo: PDFImage;
    clinicName: string;
    clinicTagline: string;
  }) {
    this.pdf = input.pdf;
    this.regular = input.regular;
    this.bold = input.bold;
    this.logo = input.logo;
    this.clinicName = input.clinicName;
    this.clinicTagline = input.clinicTagline;
    this.addPage();
  }

  static async create(input: { clinicName: string; clinicTagline: string; logoBytes: Uint8Array }) {
    const pdf = await PDFDocument.create();
    const [regular, bold, logo] = await Promise.all([
      pdf.embedFont(StandardFonts.Helvetica),
      pdf.embedFont(StandardFonts.HelveticaBold),
      pdf.embedPng(input.logoBytes),
    ]);
    return new DocumentPdfLayout({ pdf, regular, bold, logo, ...input });
  }

  private drawHeader(page: PDFPage) {
    const dimensions = this.logo.scaleToFit(145, 92);
    page.drawImage(this.logo, {
      x: documentTheme.marginX,
      y: A4_SIZE[1] - 46 - dimensions.height,
      width: dimensions.width,
      height: dimensions.height,
    });
    page.drawLine({
      start: { x: documentTheme.marginX, y: 716 },
      end: { x: A4_SIZE[0] - documentTheme.marginX, y: 716 },
      thickness: 0.8,
      color: documentTheme.teal,
    });
  }

  private addPage() {
    this.page = this.pdf.addPage(A4_SIZE);
    this.pages.push(this.page);
    this.drawHeader(this.page);
    this.cursorY = documentTheme.topContentY;
  }

  ensureSpace(height: number) {
    if (this.cursorY - height < documentTheme.bottomContentY) this.addPage();
  }

  gap(size = 12) { this.cursorY -= size; }

  title(value: string) {
    this.ensureSpace(42);
    const size = 17;
    const width = this.bold.widthOfTextAtSize(value, size);
    this.page.drawText(value, {
      x: Math.max(documentTheme.marginX, (A4_SIZE[0] - width) / 2),
      y: this.cursorY,
      size,
      font: this.bold,
      color: documentTheme.text,
    });
    this.cursorY -= 38;
  }

  statusBanner(value: string) {
    this.ensureSpace(34);
    this.page.drawRectangle({
      x: documentTheme.marginX,
      y: this.cursorY - 6,
      width: A4_SIZE[0] - documentTheme.marginX * 2,
      height: 26,
      color: documentTheme.softTeal,
      borderColor: documentTheme.teal,
      borderWidth: 0.6,
    });
    this.page.drawText(value, { x: documentTheme.marginX + 10, y: this.cursorY + 3, size: 9, font: this.bold, color: documentTheme.teal });
    this.cursorY -= 38;
  }

  labelValue(label: string, value: string) {
    this.ensureSpace(25);
    const labelText = `${label}:`;
    this.page.drawText(labelText, { x: documentTheme.marginX, y: this.cursorY, size: 10, font: this.bold, color: documentTheme.text });
    const offset = this.bold.widthOfTextAtSize(labelText, 10) + 7;
    this.page.drawText(value, { x: documentTheme.marginX + offset, y: this.cursorY, size: 10, font: this.regular, color: documentTheme.text, maxWidth: A4_SIZE[0] - documentTheme.marginX * 2 - offset });
    this.cursorY -= 22;
  }

  paragraph(value: string, options?: { size?: number; strong?: boolean; indent?: number }) {
    const size = options?.size ?? 11;
    const font = options?.strong ? this.bold : this.regular;
    const indent = options?.indent ?? 0;
    const maxWidth = A4_SIZE[0] - documentTheme.marginX * 2 - indent;
    const lines = wrapText(value, font, size, maxWidth);
    const lineHeight = size * 1.48;
    for (const line of lines) {
      this.ensureSpace(lineHeight + 2);
      if (line) this.page.drawText(line, { x: documentTheme.marginX + indent, y: this.cursorY, size, font, color: documentTheme.text });
      this.cursorY -= lineHeight;
    }
  }

  tableHeader(columns: Array<{ text: string; x: number }>) {
    this.ensureSpace(28);
    this.page.drawRectangle({ x: documentTheme.marginX, y: this.cursorY - 7, width: A4_SIZE[0] - documentTheme.marginX * 2, height: 25, color: documentTheme.softTeal });
    for (const column of columns) this.page.drawText(column.text, { x: column.x, y: this.cursorY + 1, size: 8, font: this.bold, color: documentTheme.text });
    this.cursorY -= 30;
  }

  tableRow(cells: Array<{ text: string; x: number; width: number; align?: "left" | "right" }>, height = 30, onNewPage?: () => void) {
    if (this.cursorY - height < documentTheme.bottomContentY) {
      this.addPage();
      onNewPage?.();
    }
    for (const cell of cells) {
      const lines = wrapText(cell.text, this.regular, 8.5, cell.width).slice(0, 2);
      lines.forEach((line, index) => {
        const textWidth = this.regular.widthOfTextAtSize(line, 8.5);
        const x = cell.align === "right" ? cell.x + cell.width - textWidth : cell.x;
        this.page.drawText(line, { x, y: this.cursorY - index * 11, size: 8.5, font: this.regular, color: documentTheme.text });
      });
    }
    this.page.drawLine({ start: { x: documentTheme.marginX, y: this.cursorY - height + 8 }, end: { x: A4_SIZE[0] - documentTheme.marginX, y: this.cursorY - height + 8 }, thickness: 0.4, color: documentTheme.line });
    this.cursorY -= height;
  }

  signature(input: { professionalName: string; registration: string }) {
    this.ensureSpace(105);
    this.cursorY -= 42;
    const startX = 292;
    this.page.drawLine({ start: { x: startX, y: this.cursorY }, end: { x: A4_SIZE[0] - documentTheme.marginX, y: this.cursorY }, thickness: 0.7, color: documentTheme.muted });
    this.cursorY -= 15;
    this.page.drawText(`Dr(a). ${input.professionalName}`, { x: startX, y: this.cursorY, size: 9.5, font: this.bold, color: documentTheme.text });
    this.cursorY -= 13;
    this.page.drawText("Cirurgião-dentista", { x: startX, y: this.cursorY, size: 9, font: this.regular, color: documentTheme.text });
    this.cursorY -= 13;
    this.page.drawText(input.registration, { x: startX, y: this.cursorY, size: 9, font: this.regular, color: documentTheme.text });
    this.cursorY -= 13;
    this.page.drawText("Assinatura física", { x: startX, y: this.cursorY, size: 8, font: this.regular, color: documentTheme.muted });
  }

  async save() {
    this.pages.forEach((page, index) => {
      const footerY = 48;
      page.drawLine({ start: { x: documentTheme.marginX, y: footerY + 17 }, end: { x: A4_SIZE[0] - documentTheme.marginX, y: footerY + 17 }, thickness: 0.5, color: documentTheme.line });
      page.drawText(`${this.clinicName} · ${this.clinicTagline}`, { x: documentTheme.marginX, y: footerY, size: 7.5, font: this.regular, color: documentTheme.muted });
      const pagination = `Página ${index + 1} de ${this.pages.length}`;
      const paginationWidth = this.regular.widthOfTextAtSize(pagination, 7.5);
      page.drawText(pagination, { x: A4_SIZE[0] - documentTheme.marginX - paginationWidth, y: footerY, size: 7.5, font: this.regular, color: documentTheme.muted });
    });
    return Buffer.from(await this.pdf.save({ useObjectStreams: false }));
  }
}
