"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isValidUuid,
  validateClinicalAlertsFormData,
  validatePatientFormData,
} from "@/lib/patients/validation";
import type { PatientActionState } from "@/lib/patients/types";

function rpcErrorMessage(code: string | undefined) {
  if (code === "42501") return "Você não tem permissão para realizar esta ação.";
  if (code === "P0002") return "Paciente não encontrado ou inacessível.";
  if (code === "23514" || code === "22023") {
    return "Revise os dados informados e tente novamente.";
  }
  return "Não foi possível salvar os dados do paciente.";
}

export async function createPatient(
  _previousState: PatientActionState,
  formData: FormData
): Promise<PatientActionState> {
  const user = await requireUser();
  const parsed = validatePatientFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }

  const clinical = validateClinicalAlertsFormData(formData);
  if (!clinical.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: clinical.fieldErrors };
  }

  const canEditClinical = user.perfil === "dentista";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_patient", {
    p_nome: parsed.data.nome,
    p_data_nascimento: parsed.data.dataNascimento,
    p_telefone_contato: parsed.data.telefoneContato,
    p_documento_identificacao: parsed.data.documentoIdentificacao,
    p_alergias: canEditClinical ? clinical.data.alergias : null,
    p_intolerancias: canEditClinical ? clinical.data.intolerancias : null,
    p_medicamentos_em_uso: canEditClinical
      ? clinical.data.medicamentosEmUso
      : null,
  });

  if (error || !data) {
    console.error("Falha na RPC create_patient", { code: error?.code });
    return { success: false, error: rpcErrorMessage(error?.code) };
  }

  const patient = data as { id: string };
  revalidatePath("/pacientes");
  redirect(`/pacientes/${patient.id}`);
}

export async function updatePatient(
  _previousState: PatientActionState,
  formData: FormData
): Promise<PatientActionState> {
  await requireUser();
  const patientId = String(formData.get("patientId") ?? "");
  if (!isValidUuid(patientId)) {
    return { success: false, error: "Paciente inválido." };
  }

  const parsed = validatePatientFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_patient", {
    p_paciente_id: patientId,
    p_nome: parsed.data.nome,
    p_data_nascimento: parsed.data.dataNascimento,
    p_telefone_contato: parsed.data.telefoneContato,
    p_documento_identificacao: parsed.data.documentoIdentificacao,
  });

  if (error) {
    console.error("Falha na RPC update_patient", { code: error.code });
    return { success: false, error: rpcErrorMessage(error.code) };
  }

  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/pacientes/${patientId}`);
}

export async function updatePatientClinicalAlerts(
  _previousState: PatientActionState,
  formData: FormData
): Promise<PatientActionState> {
  const user = await requireUser();
  if (user.perfil !== "dentista") {
    return { success: false, error: "Você não tem permissão para alterar dados clínicos." };
  }

  const patientId = String(formData.get("patientId") ?? "");
  if (!isValidUuid(patientId)) {
    return { success: false, error: "Paciente inválido." };
  }

  const parsed = validateClinicalAlertsFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_patient_clinical_alerts", {
    p_paciente_id: patientId,
    p_alergias: parsed.data.alergias,
    p_intolerancias: parsed.data.intolerancias,
    p_medicamentos_em_uso: parsed.data.medicamentosEmUso,
  });

  if (error) {
    console.error("Falha na RPC update_patient_clinical_alerts", { code: error.code });
    return { success: false, error: rpcErrorMessage(error.code) };
  }

  revalidatePath(`/pacientes/${patientId}`);
  return { success: true, error: null };
}

export async function setPatientActive(
  formData: FormData
): Promise<PatientActionState> {
  await requireAdmin();
  const patientId = String(formData.get("patientId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!isValidUuid(patientId)) {
    return { success: false, error: "Paciente inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_patient_active", {
    p_paciente_id: patientId,
    p_ativo: active,
  });

  if (error) {
    console.error("Falha na RPC set_patient_active", { code: error.code });
    return { success: false, error: rpcErrorMessage(error.code) };
  }

  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${patientId}`);
  return { success: true, error: null };
}
