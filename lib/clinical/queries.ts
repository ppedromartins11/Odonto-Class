import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Attendance, Procedure } from "./types";

const ATTENDANCE_FIELDS =
  "id, agendamento_id, paciente_id, profissional_id, iniciado_em, finalizado_em, status, evolucao, created_at, updated_at, created_by, updated_by";
const PROCEDURE_FIELDS =
  "id, atendimento_id, descricao, dente, material_utilizado, cor_resina, detalhes, created_at, updated_at, created_by, updated_by";

function clinicalFailure(scope: string, code?: string) {
  console.error(scope, { code });
  throw new Error(scope);
}

export async function getAttendance(id: string): Promise<Attendance | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("atendimentos")
    .select(ATTENDANCE_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) clinicalFailure("ATTENDANCE_LOAD_FAILED", error.code);
  return (data as Attendance | null) ?? null;
}

export async function getAttendanceByAppointment(appointmentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("atendimentos")
    .select(ATTENDANCE_FIELDS)
    .eq("agendamento_id", appointmentId)
    .maybeSingle();
  if (error) clinicalFailure("ATTENDANCE_BY_APPOINTMENT_FAILED", error.code);
  return (data as Attendance | null) ?? null;
}

/**
 * Resolve em lote os atendimentos que o dentista autenticado já pode ler.
 * A RLS de `atendimentos` continua sendo a fonte definitiva de autorização.
 */
export async function listAttendanceIdsByAppointment(appointmentIds: string[]) {
  if (appointmentIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("atendimentos")
    .select("id, agendamento_id")
    .in("agendamento_id", appointmentIds);
  if (error) clinicalFailure("AGENDA_ATTENDANCES_LOAD_FAILED", error.code);
  return (data ?? []) as Array<{ id: string; agendamento_id: string | null }>;
}

export async function listPatientAttendances(patientId: string, limit = 10) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("atendimentos")
    .select(ATTENDANCE_FIELDS)
    .eq("paciente_id", patientId)
    .order("iniciado_em", { ascending: false })
    .limit(limit);
  if (error) clinicalFailure("PATIENT_ATTENDANCES_LOAD_FAILED", error.code);
  return (data ?? []) as Attendance[];
}

export async function countPatientAttendances(patientId: string) {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("atendimentos")
    .select("id", { count: "exact", head: true })
    .eq("paciente_id", patientId);
  if (error) clinicalFailure("PATIENT_ATTENDANCES_COUNT_FAILED", error.code);
  return count ?? 0;
}

export async function getActivePatientAttendance(patientId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("atendimentos")
    .select(ATTENDANCE_FIELDS)
    .eq("paciente_id", patientId)
    .eq("status", "em_andamento")
    .order("iniciado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) clinicalFailure("ACTIVE_PATIENT_ATTENDANCE_LOAD_FAILED", error.code);
  return (data as Attendance | null) ?? null;
}

export async function listProcedures(attendanceId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("procedimentos")
    .select(PROCEDURE_FIELDS)
    .eq("atendimento_id", attendanceId)
    .order("created_at");
  if (error) clinicalFailure("PROCEDURE_LIST_FAILED", error.code);
  return (data ?? []) as Procedure[];
}

/**
 * Carrega os procedimentos visiveis de um paciente em uma unica consulta.
 * O relacionamento inner permite filtrar pelo paciente sem buscar cada
 * atendimento separadamente; RLS continua aplicada nas duas tabelas.
 */
export async function listPatientProcedures(patientId: string, limit = 50) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("procedimentos")
    .select(`${PROCEDURE_FIELDS},atendimentos!inner(id,paciente_id,iniciado_em,profissional_id,profissionais!inner(usuarios!inner(nome)))`)
    .eq("atendimentos.paciente_id", patientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) clinicalFailure("PATIENT_PROCEDURES_LOAD_FAILED", error.code);

  return (data ?? []).map((item) => {
    const rawAttendance = item.atendimentos as unknown as Pick<Attendance, "id" | "paciente_id" | "iniciado_em" | "profissional_id"> & {
      profissionais?: { usuarios?: { nome?: string } | null } | null;
    };
    const attendance = {
      id: rawAttendance.id,
      paciente_id: rawAttendance.paciente_id,
      iniciado_em: rawAttendance.iniciado_em,
      profissional_id: rawAttendance.profissional_id,
      profissional_nome: rawAttendance.profissionais?.usuarios?.nome ?? "Profissional indisponível",
    };
    const fields = { ...item } as Record<string, unknown>;
    delete fields.atendimentos;
    return { ...fields, attendance } as Procedure & { attendance: typeof attendance };
  });
}

export async function getProcedure(id: string): Promise<Procedure | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("procedimentos")
    .select(PROCEDURE_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) clinicalFailure("PROCEDURE_LOAD_FAILED", error.code);
  return (data as Procedure | null) ?? null;
}
