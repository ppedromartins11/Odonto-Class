"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DomainActionState } from "@/lib/agenda/types";
import { validateEvolution, validateProcedureFormData } from "@/lib/clinical/validation";
import { isValidUuid } from "@/lib/patients/validation";

function clinicalError(code?: string) {
  if (code === "42501") return "Você não tem permissão para acessar este registro clínico.";
  if (code === "P0002") return "Registro clínico não encontrado ou inacessível.";
  if (code === "23514" || code === "22023") return "A operação não é válida para o estado atual.";
  return "Não foi possível salvar o registro clínico.";
}

async function requireDentist() {
  const user = await requireUser();
  return user.perfil === "dentista" ? user : null;
}

export async function startAttendance(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  if (!(await requireDentist())) return { success: false, error: "Acesso clínico restrito a dentista." };
  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (!isValidUuid(appointmentId)) return { success: false, error: "Agendamento inválido." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_attendance", {
    p_agendamento_id: appointmentId,
  });
  if (error || !data) {
    console.error("Falha na RPC start_attendance", { code: error?.code });
    return { success: false, error: clinicalError(error?.code) };
  }
  redirect(`/atendimentos/${(data as { id: string }).id}`);
}

export async function createDirectAttendance(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  if (!(await requireDentist())) return { success: false, error: "Acesso clínico restrito a dentista." };
  const patientId = String(formData.get("patientId") ?? "");
  if (!isValidUuid(patientId)) return { success: false, error: "Paciente inválido." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_direct_attendance", {
    p_paciente_id: patientId,
  });
  if (error || !data) {
    console.error("Falha na RPC create_direct_attendance", { code: error?.code });
    return { success: false, error: clinicalError(error?.code) };
  }
  redirect(`/atendimentos/${(data as { id: string }).id}`);
}

export async function saveEvolution(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  if (!(await requireDentist())) return { success: false, error: "Acesso clínico restrito a dentista." };
  const attendanceId = String(formData.get("attendanceId") ?? "");
  if (!isValidUuid(attendanceId)) return { success: false, error: "Atendimento inválido." };
  const parsed = validateEvolution(formData.get("evolucao"), false);
  if (!parsed.success) return { success: false, error: "Revise a evolução.", fieldErrors: parsed.fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_attendance", {
    p_atendimento_id: attendanceId,
    p_evolucao: parsed.data,
  });
  if (error) {
    console.error("Falha na RPC update_attendance", { code: error.code });
    return { success: false, error: clinicalError(error.code) };
  }
  revalidatePath(`/atendimentos/${attendanceId}`);
  return { success: true, error: null };
}

export async function finalizeAttendance(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  if (!(await requireDentist())) return { success: false, error: "Acesso clínico restrito a dentista." };
  const attendanceId = String(formData.get("attendanceId") ?? "");
  if (!isValidUuid(attendanceId)) return { success: false, error: "Atendimento inválido." };
  const parsed = validateEvolution(formData.get("evolucao"), true);
  if (!parsed.success) return { success: false, error: "Revise a evolução.", fieldErrors: parsed.fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("finalize_attendance", {
    p_atendimento_id: attendanceId,
    p_evolucao: parsed.data,
  });
  if (error || !data) {
    console.error("Falha na RPC finalize_attendance", { code: error?.code });
    return { success: false, error: clinicalError(error?.code) };
  }
  const attendance = data as { paciente_id: string };
  revalidatePath("/agenda");
  revalidatePath(`/pacientes/${attendance.paciente_id}`);
  revalidatePath(`/atendimentos/${attendanceId}`);
  return { success: true, error: null };
}

export async function createProcedure(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  if (!(await requireDentist())) return { success: false, error: "Acesso clínico restrito a dentista." };
  const attendanceId = String(formData.get("attendanceId") ?? "");
  if (!isValidUuid(attendanceId)) return { success: false, error: "Atendimento inválido." };
  const parsed = validateProcedureFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_procedure", {
    p_atendimento_id: attendanceId,
    p_descricao: parsed.data.descricao,
    p_dente: parsed.data.dente,
    p_material_utilizado: parsed.data.materialUtilizado,
    p_cor_resina: parsed.data.corResina,
    p_detalhes: parsed.data.detalhes,
  });
  if (error) {
    console.error("Falha na RPC create_procedure", { code: error.code });
    return { success: false, error: clinicalError(error.code) };
  }
  revalidatePath(`/atendimentos/${attendanceId}`);
  return { success: true, error: null };
}

export async function updateProcedure(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  if (!(await requireDentist())) return { success: false, error: "Acesso clínico restrito a dentista." };
  const procedureId = String(formData.get("procedureId") ?? "");
  const attendanceId = String(formData.get("attendanceId") ?? "");
  if (!isValidUuid(procedureId) || !isValidUuid(attendanceId)) {
    return { success: false, error: "Procedimento inválido." };
  }
  const parsed = validateProcedureFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_procedure", {
    p_procedimento_id: procedureId,
    p_descricao: parsed.data.descricao,
    p_dente: parsed.data.dente,
    p_material_utilizado: parsed.data.materialUtilizado,
    p_cor_resina: parsed.data.corResina,
    p_detalhes: parsed.data.detalhes,
  });
  if (error) {
    console.error("Falha na RPC update_procedure", { code: error.code });
    return { success: false, error: clinicalError(error.code) };
  }
  revalidatePath(`/atendimentos/${attendanceId}`);
  redirect(`/atendimentos/${attendanceId}`);
}
