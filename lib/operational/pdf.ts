import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DocumentType } from "./types";

export async function renderPatientDocumentPdf(input: { clinicName: string; patientName: string; professionalName: string; type: DocumentType; issuedAt: string; periodStart?: string | null; periodEnd?: string | null; additionalText?: string | null }) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); const lines: string[] = [input.clinicName, input.type === "atestado" ? "ATESTADO" : "DECLARAÇÃO", `Paciente: ${input.patientName}`, `Profissional: ${input.professionalName}`, `Data: ${input.issuedAt}`];
  if (input.type === "atestado" && input.periodStart) lines.push(`Período: ${input.periodStart}${input.periodEnd ? ` a ${input.periodEnd}` : ""}`);
  lines.push(input.additionalText || (input.type === "atestado" ? "Atesto, para os devidos fins, a informação acima." : "Declaro, para os devidos fins, o comparecimento do paciente."));
  let y = 780; lines.forEach((line, i) => { const size = i < 2 ? 16 : 11; page.drawText(line, { x: 54, y, size, font: i < 2 ? bold : font, color: rgb(0.12, 0.16, 0.22), maxWidth: 487, lineHeight: 16 }); y -= i < 2 ? 38 : 32; }); page.drawLine({ start: { x: 360, y: 120 }, end: { x: 540, y: 120 }, thickness: 1, color: rgb(0.4, 0.4, 0.4) }); page.drawText("Assinatura do profissional", { x: 380, y: 105, size: 9, font }); return Buffer.from(await pdf.save());
}
