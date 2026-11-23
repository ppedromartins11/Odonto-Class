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
  const submitted = {
    pacienteId: String(formData.get("pacienteId") ?? ""),
    profissionalId: String(formData.get("profissionalId") ?? ""),
    inicioLocal: String(formData.get("inicioLocal") ?? ""),
    fimLocal: String(formData.get("fimLocal") ?? ""),
    observacoesAdministrativas: String(formData.get("observacoesAdministrativas") ?? "") || null,
  };
  const parsed = validateAppointmentFormData(formData);
  if (!parsed.success) {
    return { success: false, error: "Revise os campos destacados.", fieldErrors: parsed.fieldErrors, submitted };
  }
  const requestId = String(formData.get("requestId") ?? "");
  const returnId = String(formData.get("returnId") ?? "");
  if (!isValidUuid(requestId) || (returnId && !isValidUuid(returnId))) {
    return { success: false, error: "Solicitação de agendamento inválida. Reabra o formulário.", submitted };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_appointment_consistent", {
      p_request_id: requestId,
      p_retorno_id: returnId || null,
      p_paciente_id: parsed.data.pacienteId,
      p_profissional_id: parsed.data.profissionalId,
      p_inicio_local: parsed.data.inicioLocal,
      p_fim_local: parsed.data.fimLocal,
      p_observacoes_administrativas: parsed.data.observacoesAdministrativas,
    });
    if (error) {
      console.error("Falha na RPC create_appointment_consistent", { code: error.code });
      if (error.message === "RETURN_ALREADY_SCHEDULED") {
        return { success: false, error: "Este retorno já possui um agendamento. Consulte a lista de retornos antes de tentar novamente.", submitted };
      }
      if (error.message === "RETURN_NOT_PENDING") {
        return { success: false, error: "Este retorno não está pendente para agendamento. Consulte a lista de retornos.", submitted };
      }
      if (error.code === "PGRST202") {
        return { success: false, error: "O agendamento está indisponível porque o banco precisa de uma atualização. Nenhum agendamento foi criado. Avise a administração.", submitted };
      }
      if (error.code === "P0002") return { success: false, error: "Retorno não encontrado. Reabra a lista de retornos.", submitted };
      if (["23P01", "42501", "23514", "22023", "22P02"].includes(error.code ?? "")) {
        return { success: false, error: agendaError(error.code), submitted };
      }
      return { success: false, error: "Não foi possível confirmar o resultado. Tente novamente neste formulário; a mesma solicitação não criará outra consulta.", submitted };
    }
    const appointmentId = (data as { id?: string } | null)?.id;
    if (!appointmentId || !isValidUuid(appointmentId)) {
      return { success: false, error: "Não foi possível confirmar o resultado. Tente novamente neste formulário; a mesma solicitação não criará outra consulta.", submitted };
    }
    revalidatePath("/agenda");
    if (returnId) revalidatePath("/retornos");
    return { success: true, error: null, appointmentId };
  } catch {
    return { success: false, error: "A conexão falhou e o resultado é desconhecido. Tente novamente neste formulário; a mesma solicitação não criará outra consulta.", submitted };
  }
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
    return { success: false, error: error.message === "ATTENDANCE_ALREADY_STARTED"
      ? "O atendimento já foi iniciado. Não é possível trocar seu paciente ou profissional."
      : agendaError(error.code) };
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
  revalidatePath("/retornos");
  return { success: true, error: null };
}
