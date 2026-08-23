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
