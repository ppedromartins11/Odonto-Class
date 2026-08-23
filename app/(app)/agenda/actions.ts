"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppointmentStatus, DomainActionState } from "@/lib/agenda/types";
import { validateAppointmentFormData } from "@/lib/agenda/validation";
import { isValidUuid } from "@/lib/patients/validation";

function agendaError(code?: string) {
  if (code === "23P01") return "Este profissional já possui um agendamento nesse horário.";
  if (code === "42501") return "Você não tem permissão para realizar esta ação.";
  if (code === "P0002") return "Agendamento não encontrado ou inacessível.";
  if (code === "23514" || code === "22023" || code === "22P02") {
    return "A operação não é válida para o horário ou estado atual.";
  }
  return "Não foi possível salvar o agendamento.";
}

function canManageAgenda(profile: string) {
  return profile === "administrador" || profile === "recepcao";
}

export async function createAppointment(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  const user = await requireUser();
  if (!canManageAgenda(user.perfil)) {
    return { success: false, error: "Você não tem permissão para manter a agenda." };
  }
  const parsed = validateAppointmentFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_appointment", {
    p_paciente_id: parsed.data.pacienteId,
    p_profissional_id: parsed.data.profissionalId,
    p_inicio_local: parsed.data.inicioLocal,
    p_fim_local: parsed.data.fimLocal,
    p_observacoes_administrativas: parsed.data.observacoesAdministrativas,
  });
  if (error || !data) {
    console.error("Falha na RPC create_appointment", { code: error?.code });
    return { success: false, error: agendaError(error?.code) };
  }
  const returnId = String(formData.get("returnId") ?? "");
  if (returnId) {
    const { error: returnError } = await supabase.rpc("link_return_appointment", {
      p_retorno_id: returnId,
      p_agendamento_id: (data as { id: string }).id,
    });
    if (returnError) return { success: false, error: "Agendamento criado, mas o retorno não foi vinculado." };
  }
  revalidatePath("/agenda");
  redirect(`/agenda?data=${parsed.data.inicioLocal.slice(0, 10)}`);
}

export async function updateAppointment(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  const user = await requireUser();
  if (!canManageAgenda(user.perfil)) {
    return { success: false, error: "Você não tem permissão para manter a agenda." };
  }
  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (!isValidUuid(appointmentId)) return { success: false, error: "Agendamento inválido." };
  const parsed = validateAppointmentFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_appointment", {
    p_agendamento_id: appointmentId,
    p_paciente_id: parsed.data.pacienteId,
    p_profissional_id: parsed.data.profissionalId,
    p_inicio_local: parsed.data.inicioLocal,
    p_fim_local: parsed.data.fimLocal,
    p_observacoes_administrativas: parsed.data.observacoesAdministrativas,
  });
  if (error) {
    console.error("Falha na RPC update_appointment", { code: error.code });
    return { success: false, error: agendaError(error.code) };
  }
  revalidatePath("/agenda");
  revalidatePath(`/agenda/${appointmentId}/editar`);
  redirect(`/agenda?data=${parsed.data.inicioLocal.slice(0, 10)}`);
}

export async function changeAppointmentStatus(
  _previousState: DomainActionState,
  formData: FormData
): Promise<DomainActionState> {
  const user = await requireUser();
  if (!canManageAgenda(user.perfil)) {
    return { success: false, error: "Você não tem permissão para alterar o status." };
  }
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const status = String(formData.get("status") ?? "") as AppointmentStatus;
  if (!isValidUuid(appointmentId) || !["confirmado", "cancelado", "faltou"].includes(status)) {
    return { success: false, error: "Solicitação inválida." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_appointment_status", {
    p_agendamento_id: appointmentId,
    p_status: status,
  });
  if (error) {
    console.error("Falha na RPC set_appointment_status", { code: error.code });
    return { success: false, error: agendaError(error.code) };
  }
  revalidatePath("/agenda");
  revalidatePath("/pacientes");
  return { success: true, error: null };
}
