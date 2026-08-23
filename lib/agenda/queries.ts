import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActiveProfessional, AgendaItem, Appointment } from "./types";

const APPOINTMENT_FIELDS =
  "id, paciente_id, profissional_id, inicio, fim, status, observacoes_administrativas, created_at, updated_at, created_by, updated_by";

function queryFailure(scope: string, code?: string) {
  console.error(scope, { code });
  throw new Error(scope);
}

export async function listActiveProfessionals(): Promise<ActiveProfessional[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_active_professionals");
  if (error) queryFailure("PROFESSIONAL_LIST_FAILED", error.code);
  return (data ?? []) as ActiveProfessional[];
}

export async function listAgenda({
  startDate,
  endDate,
  professionalId,
}: {
  startDate: string;
  endDate: string;
  professionalId?: string | null;
}): Promise<AgendaItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_agenda", {
    p_data_inicio: startDate,
    p_data_fim: endDate,
    p_profissional_id: professionalId ?? null,
  });
  if (error) queryFailure("AGENDA_LIST_FAILED", error.code);
  return (data ?? []) as AgendaItem[];
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agendamentos")
    .select(APPOINTMENT_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) queryFailure("APPOINTMENT_LOAD_FAILED", error.code);
  return (data as Appointment | null) ?? null;
}

export async function listPatientAppointments(patientId: string, limit = 10) {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, professionals] = await Promise.all([
    supabase
      .from("agendamentos")
      .select(APPOINTMENT_FIELDS)
      .eq("paciente_id", patientId)
      .order("inicio", { ascending: false })
      .limit(limit),
    listActiveProfessionals(),
  ]);
  if (error) queryFailure("PATIENT_APPOINTMENTS_LOAD_FAILED", error.code);
  const names = new Map(professionals.map((item) => [item.id, item.nome]));
  return ((data ?? []) as Appointment[]).map((item) => ({
    ...item,
    profissional_nome: names.get(item.profissional_id) ?? "Profissional preservado",
  }));
}
