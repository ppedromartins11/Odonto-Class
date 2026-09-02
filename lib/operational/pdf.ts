import "server-only";
import { DocumentPdfLayout } from "../documents/pdf-layout";
import { formatDocumentDate, formatDocumentDateTime, formatDocumentTime, sentence } from "../documents/format";
import { loadDocumentLogo } from "../documents/logo";
import type { OfficialDocumentPdfInput } from "../documents/types";

const titles = {
  atestado: "ATESTADO ODONTOLÓGICO",
  declaracao_comparecimento: "DECLARAÇÃO DE COMPARECIMENTO",
  declaracao_acompanhamento: "DECLARAÇÃO DE ACOMPANHAMENTO",
} as const;

export async function renderPatientDocumentPdf(input: OfficialDocumentPdfInput) {
  const layout = await DocumentPdfLayout.create({
    clinicName: input.clinicName,
    clinicTagline: input.clinicTagline,
    logoBytes: await loadDocumentLogo(),
  });
  layout.title(titles[input.type]);
  if (input.preparedForPhysicalSignature) layout.statusBanner("PREPARADO PARA ASSINATURA FÍSICA DO PROFISSIONAL AUTOR");

  layout.labelValue("Paciente", input.patientName);
  layout.labelValue("Finalidade", input.purpose);
  layout.gap(12);

  if (input.type === "atestado") {
    layout.paragraph(`Atesto que ${input.patientName} recebeu atendimento odontológico nesta clínica em ${formatDocumentDate(input.attendanceStart ?? input.issuedAt)}.`);
    if (input.absenceQuantity && input.absenceUnit) {
      const unit = input.absenceQuantity === 1
        ? input.absenceUnit === "dias" ? "dia" : "hora"
        : input.absenceUnit;
      layout.paragraph(`Recomenda-se o afastamento de suas atividades por ${input.absenceQuantity} ${unit}, a contar da data de emissão.`);
    }
    if (input.additionalText) layout.paragraph(sentence(input.additionalText));
    if (input.cidCode) layout.labelValue("CID (incluído mediante autorização registrada)", input.cidCode);
  } else if (input.type === "declaracao_comparecimento") {
    layout.paragraph(
      `Declaro que ${input.patientName} compareceu à clínica em ${formatDocumentDate(input.attendanceStart!)}, ` +
      `das ${formatDocumentTime(input.attendanceStart!)} às ${formatDocumentTime(input.attendanceEnd!)}, para ${sentence(input.purpose).toLowerCase()}`
    );
  } else {
    layout.paragraph(
      `Declaro que ${input.companionName} acompanhou ${input.patientName} durante atendimento odontológico ` +
      `em ${formatDocumentDate(input.attendanceStart!)}, das ${formatDocumentTime(input.attendanceStart!)} às ${formatDocumentTime(input.attendanceEnd!)}.`
    );
    if (input.companionIdentification) layout.labelValue("Identificação mínima do acompanhante", input.companionIdentification);
    if (input.companionRelationship) layout.labelValue("Relação/responsabilidade", input.companionRelationship);
  }

  layout.gap(22);
  layout.paragraph(`${input.clinicName}, ${formatDocumentDate(input.issuedAt)}.`, { size: 10 });
  layout.signature({ professionalName: input.professionalName, registration: input.professionalRegistration });
  return layout.save();
}
export function describeDocumentPeriod(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  return `${formatDocumentDateTime(start)}–${formatDocumentDateTime(end)}`;
}
