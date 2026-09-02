import "server-only";
import { DocumentPdfLayout } from "../documents/pdf-layout";
import { formatDocumentCurrency, formatDocumentDate } from "../documents/format";
import { loadDocumentLogo } from "../documents/logo";
import type { BudgetDetail } from "./types";

export async function renderBudgetPdf(input: BudgetDetail & { clinicName: string; clinicTagline: string }): Promise<Buffer> {
  const layout = await DocumentPdfLayout.create({
    clinicName: input.clinicName,
    clinicTagline: input.clinicTagline,
    logoBytes: await loadDocumentLogo(),
  });
  layout.title("ORÇAMENTO ODONTOLÓGICO");
  layout.labelValue("Número", String(input.numero));
  layout.labelValue("Paciente", input.paciente_nome);
  layout.labelValue("Profissional responsável", input.profissional_nome);
  layout.labelValue("Data", formatDocumentDate(input.data_orcamento));
  layout.labelValue("Validade", input.validade_em ? formatDocumentDate(input.validade_em) : "Não informada");
  layout.gap(15);
  const tableColumns = [
    { text: "DESCRIÇÃO", x: 52 },
    { text: "QTD.", x: 341 },
    { text: "UNITÁRIO", x: 386 },
    { text: "TOTAL", x: 482 },
  ];
  const repeatTableHeader = () => layout.tableHeader(tableColumns);
  repeatTableHeader();
  for (const item of input.items) {
    layout.tableRow([
      { text: item.descricao, x: 52, width: 275 },
      { text: String(item.quantidade), x: 341, width: 30, align: "right" },
      { text: formatDocumentCurrency(item.valor_unitario_centavos), x: 386, width: 72, align: "right" },
      { text: formatDocumentCurrency(item.total_centavos), x: 468, width: 75, align: "right" },
    ], 30, repeatTableHeader);
  }
  layout.gap(8);
  layout.paragraph(`Total: ${formatDocumentCurrency(input.total_centavos)}`, { strong: true });
  if (input.observacao_administrativa) {
    layout.gap(10);
    layout.paragraph("Observações", { strong: true });
    layout.paragraph(input.observacao_administrativa, { size: 9.5 });
  }
  layout.gap(25);
  layout.paragraph("Este documento registra os itens e valores existentes no momento da emissão. Versões posteriores não substituem esta versão.", { size: 8.5 });
  return layout.save();
}
