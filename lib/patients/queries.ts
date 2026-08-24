import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Patient,
  PatientClinicalAlerts,
  PatientListFilter,
  PatientListItem,
} from "./types";

const PATIENT_FIELDS =
  "id, nome, data_nascimento, telefone_contato, documento_identificacao, ativo, created_at, updated_at, created_by, updated_by";

export async function listPatients({
  query,
  page,
  filter,
  pageSize = 20,
}: {
  query: string;
  page: number;
  filter: PatientListFilter;
  pageSize?: number;
}) {
  const supabase = await createSupabaseServerClient();

  if (filter === "inativos") {
    const normalizedName = query
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const nameTerms = normalizedName.split(/\s+/).filter(Boolean);
    const phoneQuery = query.replace(/[^0-9]+/g, "");
    let request = supabase
      .from("pacientes")
      .select("id,nome,data_nascimento,telefone_contato,ativo", { count: "exact" })
      .eq("ativo", false);

    if (nameTerms.length > 0 && phoneQuery.length >= 3) {
      request = request.or(
        `and(${nameTerms.map((term) => `nome_busca.ilike.%${term}%`).join(",")}),telefone_busca.ilike.%${phoneQuery}%`
      );
    } else if (nameTerms.length > 0) {
      for (const term of nameTerms) request = request.ilike("nome_busca", `%${term}%`);
    } else if (phoneQuery.length >= 3) {
      request = request.ilike("telefone_busca", `%${phoneQuery}%`);
    }

    const { data, error, count } = await request
      .order("nome", { ascending: true })
      .order("id", { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) {
      console.error("Falha ao buscar pacientes", { code: error.code });
      throw new Error("PATIENT_LIST_FAILED");
    }

    return {
      patients: ((data ?? []).map((patient) => ({ ...patient, total_count: count ?? 0 })) as PatientListItem[]),
      total: count ?? 0,
      pageSize,
    };
  }

  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query || null,
    p_page: page,
    p_page_size: pageSize,
    p_include_inactive: filter === "todos",
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
