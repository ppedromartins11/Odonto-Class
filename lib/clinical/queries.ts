import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Attendance,
  AttendanceClinicalMaterials,
  ClinicalLotOption,
  ClinicalMaterialConsumption,
  ClinicalMaterialOption,
  ClinicalMaterialSuggestion,
  Procedure,
} from "./types";
import { sortClinicalLotsByExpiry } from "./material-consumption";

const ATTENDANCE_FIELDS =
  "id, agendamento_id, paciente_id, profissional_id, iniciado_em, finalizado_em, status, evolucao, created_at, updated_at, created_by, updated_by";
const PROCEDURE_FIELDS =
  "id, atendimento_id, descricao, dente, material_utilizado, cor_resina, detalhes, servico_id, plano_tratamento_item_id, quantidade, valor_aplicado_centavos, created_at, updated_at, created_by, updated_by, procedimento_dentes(dente_fdi)";

function normalizeProcedure(row: Record<string, unknown>): Procedure {
  const relation = Array.isArray(row.procedimento_dentes)
    ? row.procedimento_dentes as Array<{ dente_fdi?: number }>
    : [];
  const fields = { ...row };
  delete fields.procedimento_dentes;
  return {
    ...fields,
    teeth: relation
      .map((item) => item.dente_fdi)
      .filter((value): value is Procedure["teeth"][number] => typeof value === "number")
      .sort((a, b) => a - b),
  } as Procedure;
}

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
  return (data ?? []).map((item) => normalizeProcedure(item as Record<string, unknown>));
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
    return { ...normalizeProcedure(fields), attendance } as Procedure & { attendance: typeof attendance };
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
  return data ? normalizeProcedure(data as Record<string, unknown>) : null;
}

function relationOne<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

export async function getAttendanceClinicalMaterials(
  attendanceId: string
): Promise<AttendanceClinicalMaterials> {
  const supabase = await createSupabaseServerClient();
  const [consumptionsResult, suggestionsResult, materialsResult] = await Promise.all([
    supabase
      .from("consumos_clinicos_materiais")
      .select(
        "id,procedimento_id,procedimento_material_consumo_id,material_id,lote_id,quantidade,created_at,estornado_em,movimentacao_estoque_id,movimentacao_lote_id,movimentacao_estorno_id,procedimentos!inner(atendimento_id),materiais_estoque!inner(nome,unidade),lote:materiais_lotes!consumos_clinicos_materiais_lote_id_fkey(codigo_lote,data_validade)"
      )
      .eq("procedimentos.atendimento_id", attendanceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("procedimento_materiais_consumo")
      .select(
        "id,procedimento_id,material_id,quantidade_total,procedimentos!inner(atendimento_id),materiais_estoque!inner(nome,unidade,controla_lote_validade)"
      )
      .eq("procedimentos.atendimento_id", attendanceId)
      .order("created_at"),
    supabase
      .from("materiais_estoque")
      .select("id,nome,unidade,quantidade_atual,controla_lote_validade")
      .eq("ativo", true)
      .order("nome"),
  ]);

  const queryError =
    consumptionsResult.error ?? suggestionsResult.error ?? materialsResult.error;
  if (queryError) clinicalFailure("CLINICAL_MATERIALS_LOAD_FAILED", queryError.code);

  const consumptions = (consumptionsResult.data ?? []).map((item) => {
    const material = relationOne<{ nome: string; unidade: string }>(item.materiais_estoque);
    const lot = relationOne<{ codigo_lote: string; data_validade: string }>(item.lote);
    return {
      id: item.id,
      procedimento_id: item.procedimento_id,
      procedimento_material_consumo_id: item.procedimento_material_consumo_id,
      material_id: item.material_id,
      material_nome: material?.nome ?? "Material indisponível",
      unidade: material?.unidade ?? "unidade",
      lote_id: item.lote_id,
      lote_codigo: lot?.codigo_lote ?? null,
      lote_validade: lot?.data_validade ?? null,
      quantidade: item.quantidade,
      created_at: item.created_at,
      estornado_em: item.estornado_em,
      movimentacao_estoque_id: item.movimentacao_estoque_id,
      movimentacao_lote_id: item.movimentacao_lote_id,
      movimentacao_estorno_id: item.movimentacao_estorno_id,
    } satisfies ClinicalMaterialConsumption;
  });

  const activeSnapshotIds = new Set(
    consumptions
      .filter((item) => item.estornado_em === null)
      .map((item) => item.procedimento_material_consumo_id)
      .filter((id): id is string => id !== null)
  );
  const suggestions = (suggestionsResult.data ?? []).map((item) => {
    const material = relationOne<{
      nome: string;
      unidade: string;
      controla_lote_validade: boolean;
    }>(item.materiais_estoque);
    return {
      id: item.id,
      procedimento_id: item.procedimento_id,
      material_id: item.material_id,
      material_nome: material?.nome ?? "Material indisponível",
      unidade: material?.unidade ?? "unidade",
      quantidade_prevista: item.quantidade_total,
      controla_lote_validade: material?.controla_lote_validade ?? false,
      consumo_ativo_registrado: activeSnapshotIds.has(item.id),
    } satisfies ClinicalMaterialSuggestion;
  });

  return {
    consumptions,
    suggestions,
    materials: (materialsResult.data ?? []) as ClinicalMaterialOption[],
  };
}

export async function listAvailableClinicalLots(
  materialId: string
): Promise<ClinicalLotOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("clinic_today");
  if (todayError || typeof today !== "string") {
    clinicalFailure("CLINICAL_LOTS_DATE_FAILED", todayError?.code);
  }
  const { data, error } = await supabase
    .from("materiais_lotes")
    .select("id,material_id,codigo_lote,data_validade,quantidade_atual")
    .eq("material_id", materialId)
    .eq("ativo", true)
    .gt("quantidade_atual", 0)
    .gte("data_validade", today)
    .order("data_validade")
    .order("codigo_lote");
  if (error) clinicalFailure("CLINICAL_LOTS_LOAD_FAILED", error.code);
  return sortClinicalLotsByExpiry((data ?? []) as ClinicalLotOption[]);
}
