import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  DocumentType,
  OperationalDocument,
  OperationalReturn,
  OperationalTask,
  PatientDocument,
  PatientFile,
} from "./types";

const RETURN_FIELDS =
  "id,paciente_id,atendimento_origem_id,profissional_id,data_prevista,status,observacao_administrativa,agendamento_id,created_at,pacientes!inner(nome),profissionais(usuarios(nome))";
const TASK_FIELDS =
  "id,titulo,descricao,status,prazo,responsavel_id,paciente_id,agendamento_id,created_by,created_at,pacientes(nome),responsavel:usuarios!tarefas_responsavel_id_fkey(nome)";
const DOCUMENT_FIELDS =
  "id,paciente_id,profissional_id,tipo,emitido_em,periodo_inicio,periodo_fim,texto_adicional,nome_arquivo,tamanho_bytes,created_at";
const FILE_FIELDS =
  "id,paciente_id,nome_original,mime_type,tamanho_bytes,categoria,status,created_at,uploaded_by";

function fail(scope: string, code?: string): never {
  console.error(scope, { code });
  throw new Error(scope);
}

function mapReturns(data: unknown[]): OperationalReturn[] {
  return data.map((item) => {
    const row = item as Record<string, unknown> & {
      pacientes?: { nome?: string } | null;
      profissionais?: { usuarios?: { nome?: string } | null } | null;
    };
    const fields = { ...row };
    delete fields.pacientes;
    delete fields.profissionais;
    return {
      ...fields,
      paciente_nome: row.pacientes?.nome ?? "Paciente indisponível",
      profissional_nome: row.profissionais?.usuarios?.nome ?? null,
    } as unknown as OperationalReturn;
  });
}

function mapTasks(data: unknown[]): OperationalTask[] {
  return data.map((item) => {
    const row = item as Record<string, unknown> & {
      pacientes?: { nome?: string } | null;
      responsavel?: { nome?: string } | null;
    };
    const fields = { ...row };
    delete fields.pacientes;
    delete fields.responsavel;
    return {
      ...fields,
      responsavel_nome: row.responsavel?.nome ?? "Responsável indisponível",
      paciente_nome: row.pacientes?.nome ?? null,
    } as unknown as OperationalTask;
  });
}

export async function listReturns(patientId?: string, limit?: number) {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("retornos").select(RETURN_FIELDS).order("data_prevista");
  if (patientId) query = query.eq("paciente_id", patientId);
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) fail("RETURNS_LOAD_FAILED", error.code);
  return mapReturns(data ?? []);
}

export async function listTasks(patientId?: string) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("tarefas")
    .select(TASK_FIELDS)
    .order("prazo", { ascending: true, nullsFirst: false });
  if (patientId) query = query.eq("paciente_id", patientId);
  const { data, error } = await query;
  if (error) fail("TASKS_LOAD_FAILED", error.code);
  return mapTasks(data ?? []);
}

/**
 * Resumo enxuto do Dashboard. Contagens usam HEAD e as listas retornam apenas
 * os quatro itens exibidos, evitando transferir tabelas operacionais inteiras.
 * Todas as consultas continuam sob a RLS do usuario autenticado.
 */
export async function getDashboardOperationalData(today: string) {
  const supabase = await createSupabaseServerClient();
  const [
    pendingTaskRows,
    overdueTaskCount,
    openReturnRows,
    pendingReturnCount,
    overdueReturnCount,
  ] = await Promise.all([
    supabase.from("tarefas").select(TASK_FIELDS, { count: "exact" }).eq("status", "pendente").order("prazo", { ascending: true, nullsFirst: false }).limit(4),
    supabase.from("tarefas").select("id", { count: "exact", head: true }).eq("status", "pendente").lt("prazo", today),
    supabase.from("retornos").select(RETURN_FIELDS).in("status", ["pendente", "agendado"]).order("data_prevista").limit(4),
    supabase.from("retornos").select("id", { count: "exact", head: true }).eq("status", "pendente"),
    supabase.from("retornos").select("id", { count: "exact", head: true }).eq("status", "pendente").lt("data_prevista", today),
  ]);

  const firstError = [pendingTaskRows, overdueTaskCount, openReturnRows, pendingReturnCount, overdueReturnCount]
    .map((result) => result.error)
    .find(Boolean);
  if (firstError) fail("DASHBOARD_OPERATIONAL_LOAD_FAILED", firstError.code);

  return {
    pendingTasks: mapTasks(pendingTaskRows.data ?? []),
    pendingTaskCount: pendingTaskRows.count ?? 0,
    overdueTaskCount: overdueTaskCount.count ?? 0,
    relevantReturns: mapReturns(openReturnRows.data ?? []),
    pendingReturnCount: pendingReturnCount.count ?? 0,
    overdueReturnCount: overdueReturnCount.count ?? 0,
  };
}

export async function listDocuments(patientId: string, limit?: number) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("documentos")
    .select(DOCUMENT_FIELDS)
    .eq("paciente_id", patientId)
    .order("emitido_em", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) fail("DOCUMENTS_LOAD_FAILED", error.code);
  return (data ?? []) as PatientDocument[];
}

export async function listOperationalDocuments({
  query,
  type,
  page,
  pageSize = 20,
}: {
  query: string;
  type?: DocumentType;
  page: number;
  pageSize?: number;
}) {
  const supabase = await createSupabaseServerClient();
  let documentsQuery = supabase
    .from("documentos")
    .select(`${DOCUMENT_FIELDS},pacientes!inner(nome),profissionais!inner(usuarios!inner(nome))`, { count: "exact" })
    .order("emitido_em", { ascending: false })
    .order("created_at", { ascending: false });
  if (type) documentsQuery = documentsQuery.eq("tipo", type);
  if (query) documentsQuery = documentsQuery.ilike("pacientes.nome", `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await documentsQuery.range(from, from + pageSize - 1);
  if (error) fail("OPERATIONAL_DOCUMENTS_LOAD_FAILED", error.code);

  const documents = (data ?? []).map((document) => {
    const patient = document.pacientes as unknown as { nome?: string } | null;
    const professional = document.profissionais as unknown as { usuarios?: { nome?: string } | null } | null;
    const fields = { ...document } as Record<string, unknown>;
    delete fields.pacientes;
    delete fields.profissionais;
    return {
      ...fields,
      paciente_nome: patient?.nome ?? "Paciente indisponível",
      profissional_nome: professional?.usuarios?.nome ?? "Profissional indisponível",
    } as OperationalDocument;
  });
  return { documents, total: count ?? 0, pageSize };
}

export async function listPatientFiles(patientId: string, limit?: number) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("arquivos_paciente")
    .select(FILE_FIELDS)
    .eq("paciente_id", patientId)
    .eq("status", "ativo")
    .order("created_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) fail("FILES_LOAD_FAILED", error.code);
  return (data ?? []) as PatientFile[];
}

export async function listTaskAssignees() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_active_task_assignees");
  if (error) fail("ASSIGNEES_LOAD_FAILED", error.code);
  return (data ?? []) as { id: string; nome: string; perfil: string }[];
}
