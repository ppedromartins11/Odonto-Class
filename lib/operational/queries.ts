import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OperationalDocument, OperationalReturn, OperationalTask, PatientDocument, PatientFile, DocumentType } from "./types";
function fail(scope: string, code?: string): never { console.error(scope, { code }); throw new Error(scope); }
export async function listReturns(patientId?: string) { const s=await createSupabaseServerClient(); let q=s.from("retornos").select("id,paciente_id,atendimento_origem_id,profissional_id,data_prevista,status,observacao_administrativa,agendamento_id,created_at").order("data_prevista"); if(patientId) q=q.eq("paciente_id",patientId); const {data,error}=await q; if(error) fail("RETURNS_LOAD_FAILED",error.code); return (data??[]) as OperationalReturn[]; }
export async function listTasks(patientId?: string) { const s=await createSupabaseServerClient(); let q=s.from("tarefas").select("id,titulo,descricao,status,prazo,responsavel_id,paciente_id,agendamento_id,created_by,created_at").order("prazo",{ascending:true,nullsFirst:false}); if(patientId) q=q.eq("paciente_id",patientId); const {data,error}=await q; if(error) fail("TASKS_LOAD_FAILED",error.code); return (data??[]) as OperationalTask[]; }
export async function listDocuments(patientId: string) { const s=await createSupabaseServerClient(); const {data,error}=await s.from("documentos").select("id,paciente_id,profissional_id,tipo,emitido_em,periodo_inicio,periodo_fim,texto_adicional,nome_arquivo,tamanho_bytes,created_at").eq("paciente_id",patientId).order("emitido_em",{ascending:false}); if(error) fail("DOCUMENTS_LOAD_FAILED",error.code); return (data??[]) as PatientDocument[]; }
export async function listOperationalDocuments({ query, type, page, pageSize = 20 }: { query: string; type?: DocumentType; page: number; pageSize?: number }) {
  const s = await createSupabaseServerClient();
  let documentsQuery = s.from("documentos").select("id,paciente_id,profissional_id,tipo,emitido_em,periodo_inicio,periodo_fim,texto_adicional,nome_arquivo,tamanho_bytes,created_at,pacientes!inner(nome),profissionais!inner(usuarios!inner(nome))", { count: "exact" }).order("emitido_em", { ascending: false }).order("created_at", { ascending: false });
  if (type) documentsQuery = documentsQuery.eq("tipo", type);
  if (query) documentsQuery = documentsQuery.ilike("pacientes.nome", `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const from = (page - 1) * pageSize; const { data, error, count } = await documentsQuery.range(from, from + pageSize - 1);
  if (error) fail("OPERATIONAL_DOCUMENTS_LOAD_FAILED", error.code);
  const documents = (data ?? []).map((document) => {
    const patient = document.pacientes as unknown as { nome?: string } | null;
    const professional = document.profissionais as unknown as { usuarios?: { nome?: string } | null } | null;
    const fields = { ...document } as Record<string, unknown>;
    delete fields.pacientes; delete fields.profissionais;
    return { ...fields, paciente_nome: patient?.nome ?? "Paciente indisponível", profissional_nome: professional?.usuarios?.nome ?? "Profissional indisponível" } as OperationalDocument;
  });
  return { documents, total: count ?? 0, pageSize };
}
export async function listPatientFiles(patientId: string) { const s=await createSupabaseServerClient(); const {data,error}=await s.from("arquivos_paciente").select("id,paciente_id,nome_original,mime_type,tamanho_bytes,categoria,status,created_at,uploaded_by").eq("paciente_id",patientId).eq("status","ativo").order("created_at",{ascending:false}); if(error) fail("FILES_LOAD_FAILED",error.code); return (data??[]) as PatientFile[]; }
export async function listTaskAssignees() { const s=await createSupabaseServerClient(); const {data,error}=await s.rpc("list_active_task_assignees"); if(error) fail("ASSIGNEES_LOAD_FAILED",error.code); return (data??[]) as {id:string;nome:string;perfil:string}[]; }
