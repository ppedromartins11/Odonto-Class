import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { packageEffectiveStatus } from "./logic";
import type { CycleStatus, OperationalSummary, PackageEffectiveStatus, ValidityLot, ValidityStatus } from "./types";

function fail(scope: string, code?: string): never { console.error(scope, { code }); throw new Error(scope); }

export async function listValidityLots(options: { query?: string; status?: ValidityStatus; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient(); const pageSize = options.pageSize ?? 20;
  const { data, error } = await supabase.rpc("list_validity_lots", { p_query: options.query || null, p_status: options.status || null, p_page: options.page, p_page_size: pageSize });
  if (error) fail("VALIDITY_LOTS_LIST_FAILED", error.code);
  const lots = (data ?? []) as ValidityLot[];
  return { lots, total: Number(lots[0]?.total_count ?? 0), pageSize };
}

export async function getValidityLot(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("materiais_lotes").select("id,material_id,codigo_lote,quantidade_inicial,quantidade_atual,data_fabricacao,data_validade,fornecedor,ativo,materiais_estoque!inner(nome,quantidade_atual,controla_lote_validade)").eq("id", id).maybeSingle();
  if (error) fail("VALIDITY_LOT_LOAD_FAILED", error.code); return data;
}

export async function listValidityLotMovements(lotId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("movimentacoes_lotes").select("id,quantidade,quantidade_lote_anterior,quantidade_lote_posterior,finalidade_saida,movimentacoes_estoque!inner(tipo,motivo,referencia,created_at,created_by,usuarios!movimentacoes_estoque_created_by_fkey(nome))").eq("lote_id", lotId).order("created_at", { ascending: false }).limit(30);
  if (error) fail("VALIDITY_LOT_MOVEMENTS_LOAD_FAILED", error.code);
  return data ?? [];
}

export async function listLotMaterials() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("materiais_estoque").select("id,nome,quantidade_atual,controla_lote_validade,ativo").eq("ativo", true).order("nome");
  if (error) fail("LOT_MATERIALS_LOAD_FAILED", error.code); return data ?? [];
}

export async function getValiditySterilizationSummary(): Promise<OperationalSummary> {
  const supabase = await createSupabaseServerClient(); const { data, error } = await supabase.rpc("get_validity_sterilization_summary");
  if (error) fail("VALIDITY_STERILIZATION_SUMMARY_FAILED", error.code);
  return ((data ?? [])[0] as OperationalSummary | undefined) ?? { lotes_validos: 0, lotes_vencendo: 0, lotes_vencidos: 0, lotes_esgotados: 0, pacotes_validos: 0, pacotes_vencendo: 0, pacotes_vencidos: 0, ciclos_hoje: 0, ciclos_em_andamento: 0, ciclos_reprovados: 0 };
}

export async function listSterilizationEquipment() {
  const supabase = await createSupabaseServerClient(); const { data, error } = await supabase.from("equipamentos_esterilizacao").select("id,nome,identificacao,modelo,fabricante,numero_serie,ativo").order("ativo", { ascending: false }).order("nome");
  if (error) fail("STERILIZATION_EQUIPMENT_LIST_FAILED", error.code); return data ?? [];
}

export async function listSterilizationCycles(options: { status?: CycleStatus; page?: number; pageSize?: number } = {}) {
  const supabase = await createSupabaseServerClient(); const page = options.page ?? 1; const pageSize = options.pageSize ?? 20;
  let query = supabase.from("ciclos_esterilizacao").select("id,codigo,equipamento_id,iniciado_em,finalizado_em,responsavel_id,status,observacoes,equipamentos_esterilizacao!inner(nome),usuarios!ciclos_esterilizacao_responsavel_id_fkey(nome)", { count: "exact" });
  if (options.status) query = query.eq("status", options.status);
  const { data, error, count } = await query.order("iniciado_em", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) fail("STERILIZATION_CYCLES_LIST_FAILED", error.code); return { cycles: data ?? [], total: count ?? 0, pageSize };
}

export async function getSterilizationCycle(id: string) {
  const supabase = await createSupabaseServerClient();
  const [cycle, packages] = await Promise.all([
    supabase.from("ciclos_esterilizacao").select("id,codigo,equipamento_id,iniciado_em,finalizado_em,responsavel_id,status,observacoes,equipamentos_esterilizacao!inner(nome),usuarios!ciclos_esterilizacao_responsavel_id_fkey(nome)").eq("id", id).maybeSingle(),
    supabase.from("pacotes_esterilizacao").select("id,ciclo_id,codigo,descricao,esterilizado_em,validade_ate,status_operacional,utilizado_em,descartado_em").eq("ciclo_id", id).order("created_at"),
  ]);
  if (cycle.error || packages.error) fail("STERILIZATION_CYCLE_LOAD_FAILED", cycle.error?.code ?? packages.error?.code);
  return { cycle: cycle.data, packages: packages.data ?? [] };
}

export async function listSterilizationPackages(options: { status?: PackageEffectiveStatus; page?: number; pageSize?: number; today: string } ) {
  const supabase = await createSupabaseServerClient(); const page = options.page ?? 1; const pageSize = options.pageSize ?? 20;
  let query = supabase.from("pacotes_esterilizacao").select("id,ciclo_id,codigo,descricao,esterilizado_em,validade_ate,status_operacional,ciclos_esterilizacao!inner(codigo,status)", { count: "exact" });
  if (options.status === "pendente") query = query.eq("status_operacional", "pendente");
  else if (options.status === "utilizado" || options.status === "descartado") query = query.eq("status_operacional", options.status);
  else if (options.status === "vencido") query = query.eq("status_operacional", "ativo").lt("validade_ate", options.today);
  else if (options.status === "proximo_do_vencimento") query = query.eq("status_operacional", "ativo").gte("validade_ate", options.today).lte("validade_ate", new Date(Date.parse(options.today + "T12:00:00Z") + 30 * 86400000).toISOString().slice(0,10));
  else if (options.status === "valido") query = query.eq("status_operacional", "ativo").gt("validade_ate", new Date(Date.parse(options.today + "T12:00:00Z") + 30 * 86400000).toISOString().slice(0,10));
  const { data, error, count } = await query.order("validade_ate").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) fail("STERILIZATION_PACKAGES_LIST_FAILED", error.code);
  return { packages: (data ?? []).map(item => ({ ...item, effective_status: packageEffectiveStatus({ status: item.status_operacional, validity: item.validade_ate, today: options.today }) ?? "pendente" as const })), total: count ?? 0, pageSize };
}
