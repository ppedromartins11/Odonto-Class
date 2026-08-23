import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Patient,
  PatientClinicalAlerts,
  PatientListItem,
} from "./types";

const PATIENT_FIELDS =
  "id, nome, data_nascimento, telefone_contato, documento_identificacao, ativo, created_at, updated_at, created_by, updated_by";

export async function listPatients({
  query,
  page,
  includeInactive,
  pageSize = 20,
}: {
  query: string;
  page: number;
  includeInactive: boolean;
  pageSize?: number;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query || null,
    p_page: page,
    p_page_size: pageSize,
    p_include_inactive: includeInactive,
  });

  if (error) {
    console.error("Falha ao buscar pacientes", { code: error.code });
    throw new Error("PATIENT_LIST_FAILED");
  }

  const patients = (data ?? []) as PatientListItem[];
  return {
    patients,
    total: Number(patients[0]?.total_count ?? 0),
    pageSize,
  };
}

export async function getPatient(patientId: string): Promise<Patient | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("pacientes")
    .select(PATIENT_FIELDS)
    .eq("id", patientId)
    .maybeSingle();

  if (error) {
    console.error("Falha ao carregar paciente", { code: error.code });
    throw new Error("PATIENT_LOAD_FAILED");
  }

  return (data as Patient | null) ?? null;
}

export async function getPatientClinicalAlerts(
  patientId: string
): Promise<PatientClinicalAlerts | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("paciente_alertas_clinicos")
    .select(
      "paciente_id, alergias, intolerancias, medicamentos_em_uso, updated_at, updated_by"
    )
    .eq("paciente_id", patientId)
    .maybeSingle();

  if (error) {
    console.error("Falha ao carregar alertas clinicos", { code: error.code });
    throw new Error("PATIENT_CLINICAL_ALERTS_LOAD_FAILED");
  }

  return (data as PatientClinicalAlerts | null) ?? null;
}
