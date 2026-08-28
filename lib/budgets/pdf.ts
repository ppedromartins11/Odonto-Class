import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatCents } from "./validation";
import type { BudgetDetail } from "./types";

export async function renderBudgetPdf(input: BudgetDetail & { clinicName: string }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = (value: string, x: number, y: number, size = 10, strong = false) => page.drawText(value, { x, y, size, font: strong ? bold : font, color: rgb(0.1, 0.14, 0.2), maxWidth: 485 });
  text(input.clinicName, 54, 790, 15, true); text("ORÇAMENTO", 54, 756, 18, true);
  text(`Orçamento nº ${input.numero}`, 54, 730, 10); text(`Data: ${input.data_orcamento}`, 360, 730, 10);
  text(`Paciente: ${input.paciente_nome}`, 54, 704, 11, true); text(`Profissional: ${input.profissional_nome}`, 54, 682, 10);
  text(`Validade: ${input.validade_em ?? "Não informada"}`, 54, 660, 10);
  let y = 620; text("Descrição", 54, y, 10, true); text("Qtd.", 350, y, 10, true); text("Unitário", 405, y, 10, true); text("Total", 495, y, 10, true); y -= 18;
  for (const item of input.items) { text(item.descricao, 54, y); text(String(item.quantidade), 350, y); text(formatCents(item.valor_unitario_centavos), 405, y); text(formatCents(item.total_centavos), 495, y); y -= 22; }
  page.drawLine({ start: { x: 54, y: y - 2 }, end: { x: 540, y: y - 2 }, thickness: 1, color: rgb(0.75, 0.78, 0.82) });
  text(`Total: ${formatCents(input.total_centavos)}`, 385, y - 28, 13, true);
  if (input.observacao_administrativa) text(`Observação: ${input.observacao_administrativa}`, 54, y - 64, 9);
  return Buffer.from(await pdf.save());
}
