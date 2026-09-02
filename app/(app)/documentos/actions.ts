"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import { DOCUMENT_LAYOUT_VERSION } from "@/lib/documents/theme";
import { renderPatientDocumentPdf } from "@/lib/operational/pdf";
import { isValidUuid } from "@/lib/patients/validation";
import type { DomainActionState, DocumentAuthorAttendance, NewDocumentType } from "@/lib/operational/types";

const validTypes: NewDocumentType[] = ["atestado", "declaracao_comparecimento", "declaracao_acompanhamento"];
const response = (error: string, fieldErrors?: Record<string, string>): DomainActionState => ({ success: false, error, fieldErrors });
const optional = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;

function friendlyDocumentError(message: string) {
  if (message.includes("registro profissional")) return "Complete o registro profissional do cirurgião-dentista antes de emitir este documento.";
  if (message.includes("CID")) return "A inclusão do CID exige a autorização registrada do paciente ou responsável.";
  if (message.includes("Somente o dentista")) return "Somente o dentista relacionado ao atendimento pode emitir este atestado.";
  if (message.includes("Atendimento")) return "O atendimento selecionado não corresponde ao paciente e profissional autor.";
  return "Não foi possível salvar o documento. Revise os dados e tente novamente.";
}
export async function createDocument(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser();
  const patientId = String(form.get("patientId") ?? form.get("pacienteId") ?? "");
  const attendanceId = String(form.get("attendanceId") ?? "");
  const professionalId = String(form.get("professionalId") ?? "");
  const type = String(form.get("type") ?? "") as NewDocumentType;
  const issuedAt = String(form.get("issuedAt") ?? "");
  const purpose = optional(form, "purpose");
  const attendanceStart = optional(form, "attendanceStart");
  const attendanceEnd = optional(form, "attendanceEnd");
  const absenceRaw = optional(form, "absenceQuantity");
  const absenceQuantity = absenceRaw ? Number(absenceRaw) : null;
  const absenceUnit = optional(form, "absenceUnit") as "horas" | "dias" | null;
  const companionName = optional(form, "companionName");
  const companionIdentification = optional(form, "companionIdentification");
  const companionRelationship = optional(form, "companionRelationship");
  const additionalText = optional(form, "additionalText");
  const cidCode = optional(form, "cidCode")?.toUpperCase() ?? null;
  const cidAuthorized = form.get("cidAuthorized") === "on";
  const cidAuthorizerType = optional(form, "cidAuthorizerType") as "paciente" | "responsavel" | null;

  if (!isValidUuid(patientId) || !isValidUuid(attendanceId) || !isValidUuid(professionalId) || !validTypes.includes(type)) {
    return response("Revise paciente, atendimento e tipo do documento.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt) || !purpose || purpose.length > 300) return response("Informe data e finalidade válidas.");
  if (user.perfil !== "dentista" && type === "atestado") return response("Somente dentistas podem emitir atestados.");
  if (type !== "atestado" && (!attendanceStart || !attendanceEnd)) return response("Informe o início e o fim do comparecimento.");
  if (attendanceStart && attendanceEnd && new Date(attendanceEnd) <= new Date(attendanceStart)) return response("O fim do comparecimento deve ser posterior ao início.");
  if (absenceQuantity !== null && (!Number.isInteger(absenceQuantity) || absenceQuantity <= 0 || !absenceUnit)) return response("Informe um afastamento válido.");
  if (type !== "atestado" && (absenceQuantity !== null || absenceUnit)) return response("Afastamento é permitido somente em atestado.");
  if (type === "declaracao_acompanhamento" && !companionName) return response("Informe o nome do acompanhante.");
  if (cidCode && (!cidAuthorized || !cidAuthorizerType)) return response("Confirme quem autorizou a inclusão do CID.");
  if (type !== "atestado" && cidCode) return response("CID é permitido somente no atestado clínico.");

  const supabase = await createSupabaseServerClient();
  const [{ data: patient }, { data: attendanceRows, error: attendanceError }] = await Promise.all([
    supabase.from("pacientes").select("nome").eq("id", patientId).maybeSingle(),
    supabase.rpc("list_document_author_attendances", { p_paciente_id: patientId }),
  ]);
  const attendance = (attendanceRows ?? []).find((row: DocumentAuthorAttendance) => row.id === attendanceId && row.profissional_id === professionalId) as DocumentAuthorAttendance | undefined;
  if (!patient || attendanceError || !attendance) return response("Paciente ou atendimento indisponível para este documento.");
  if (!attendance.registro_profissional?.trim()) return response("Complete o registro profissional do cirurgião-dentista antes de emitir este documento.");

  const bytes = await renderPatientDocumentPdf({
    clinicName: CLINIC_NAME,
    clinicTagline: CLINIC_TAGLINE,
    patientName: patient.nome,
    professionalName: attendance.profissional_nome,
    professionalRegistration: attendance.registro_profissional,
    type,
    issuedAt,
    purpose,
    attendanceStart: attendanceStart ?? attendance.iniciado_em,
    attendanceEnd: attendanceEnd ?? attendance.finalizado_em,
    absenceQuantity,
    absenceUnit,
    companionName,
    companionIdentification,
    companionRelationship,
    additionalText,
    cidCode,
    preparedForPhysicalSignature: user.perfil !== "dentista",
  });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `${patientId}/documentos/${randomUUID()}.pdf`;
  const fileName = `${type}-${issuedAt}.pdf`;
  const admin = createSupabaseAdminClient();
  const upload = await admin.storage.from("arquivos-paciente").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) return response("Não foi possível armazenar o PDF privado.");

  const metadata = await supabase.rpc("create_official_document", {
    p_paciente_id: patientId,
    p_atendimento_id: attendanceId,
    p_profissional_autor_id: professionalId,
    p_tipo: type,
    p_emitido_em: issuedAt,
    p_finalidade: purpose,
    p_comparecimento_inicio: attendanceStart ? new Date(attendanceStart).toISOString() : null,
    p_comparecimento_fim: attendanceEnd ? new Date(attendanceEnd).toISOString() : null,
    p_afastamento_quantidade: absenceQuantity,
    p_afastamento_unidade: absenceUnit,
    p_acompanhante_nome: companionName,
    p_acompanhante_identificacao: companionIdentification,
    p_acompanhante_relacao: companionRelationship,
    p_texto_adicional: additionalText,
    p_cid_codigo: cidCode,
    p_cid_autorizado: cidAuthorized,
    p_cid_autorizador_tipo: cidAuthorizerType,
    p_storage_path: path,
    p_nome_arquivo: fileName,
    p_tamanho_bytes: bytes.length,
    p_layout_version: DOCUMENT_LAYOUT_VERSION,
    p_pdf_sha256: hash,
  });
  if (metadata.error) {
    await admin.storage.from("arquivos-paciente").remove([path]);
    return response(friendlyDocumentError(metadata.error.message));
  }
  revalidatePath(`/pacientes/${patientId}`);
  revalidatePath("/documentos");
  redirect(`/pacientes/${patientId}?tab=documentos`);
}
