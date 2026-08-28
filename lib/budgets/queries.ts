import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Budget, BudgetDetail, BudgetItem, BudgetStatus } from "./types";

const BUDGET_FIELDS = "id,numero,paciente_id,profissional_id,data_orcamento,validade_em,observacao_administrativa,status,total_centavos,created_at,pacientes!inner(nome),profissionais!inner(usuarios!inner(nome))";

function fail(scope: string, code?: string): never {
  console.error(scope, { code });
  throw new Error(scope);
}

function effectiveStatus(status: BudgetStatus, validity: string | null): BudgetStatus {
  const today = new Date().toISOString().slice(0, 10);
  return status === "enviado" && validity !== null && validity < today ? "expirado" : status;
}

function mapBudget(row: Record<string, unknown>): Budget {
  const patient = row.pacientes as { nome?: string } | null;
  const professional = row.profissionais as { usuarios?: { nome?: string } | null } | null;
  const fields = { ...row };
  delete fields.pacientes;
  delete fields.profissionais;
  const status = fields.status as BudgetStatus;
  return {
    ...(fields as Omit<Budget, "paciente_nome" | "profissional_nome" | "effective_status">),
    effective_status: effectiveStatus(status, fields.validade_em as string | null),
    paciente_nome: patient?.nome ?? "Paciente indisponível",
    profissional_nome: professional?.usuarios?.nome ?? "Profissional indisponível",
  };
}

export async function listBudgets({ status, patientId, page, pageSize = 20 }: { status?: BudgetStatus; patientId?: string; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("orcamentos").select(BUDGET_FIELDS, { count: "exact" }).order("data_orcamento", { ascending: false }).order("numero", { ascending: false });
  if (status && status !== "expirado") query = query.eq("status", status);
  if (patientId) query = query.eq("paciente_id", patientId);
  if (status === "expirado") query = query.eq("status", "enviado").lt("validade_em", new Date().toISOString().slice(0, 10));
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) fail("BUDGET_LIST_FAILED", error.code);
  return { budgets: (data ?? []).map((row) => mapBudget(row as Record<string, unknown>)), total: count ?? 0, pageSize };
}

export async function getBudget(id: string): Promise<BudgetDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("orcamentos").select(BUDGET_FIELDS).eq("id", id).maybeSingle();
  if (error) fail("BUDGET_LOAD_FAILED", error.code);
  if (!data) return null;
  const { data: itemData, error: itemError } = await supabase.from("orcamento_itens").select("id,orcamento_id,descricao,quantidade,valor_unitario_centavos,total_centavos,ativo").eq("orcamento_id", id).eq("ativo", true).order("created_at");
  if (itemError) fail("BUDGET_ITEMS_LOAD_FAILED", itemError.code);
  return { ...mapBudget(data as Record<string, unknown>), items: (itemData ?? []) as BudgetItem[] };
}
