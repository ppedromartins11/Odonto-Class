export type OfficialDocumentType =
  | "atestado"
  | "declaracao_comparecimento"
  | "declaracao_acompanhamento";

export type OfficialDocumentPdfInput = {
  clinicName: string;
  clinicTagline: string;
  type: OfficialDocumentType;
  patientName: string;
  professionalName: string;
  professionalRegistration: string;
  issuedAt: string;
  purpose: string;
  attendanceStart?: string | null;
  attendanceEnd?: string | null;
  absenceQuantity?: number | null;
  absenceUnit?: "horas" | "dias" | null;
  companionName?: string | null;
  companionIdentification?: string | null;
  companionRelationship?: string | null;
  additionalText?: string | null;
  cidCode?: string | null;
  preparedForPhysicalSignature?: boolean;
};

