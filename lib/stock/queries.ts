import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StockMaterial, StockMovement, StockMovementType, StockStatus, StockSummary } from "./types";

function fail(scope: string, code?: string): never { console.error(scope, { code }); throw new Error(scope); }

export async function listStockMaterials(options: { query?: string; category?: string; status?: StockStatus; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient();
  const pageSize = options.pageSize ?? 20;
  const { data, error } = await supabase.rpc("list_stock_materials", { p_query: options.query || null, p_categoria: options.category || null, p_status: options.status || null, p_page: options.page, p_page_size: pageSize });
  if (error) fail("STOCK_MATERIALS_LIST_FAILED", error.code);
  const materials = (data ?? []) as StockMaterial[];
  return { materials, total: Number(materials[0]?.total_count ?? 0), pageSize };
}

export async function listStockMovements(options: { materialId?: string; type?: StockMovementType; startDate?: string; endDate?: string; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient();
  const pageSize = options.pageSize ?? 20;
  const { data, error } = await supabase.rpc("list_stock_movements", { p_material_id: options.materialId || null, p_tipo: options.type || null, p_inicio: options.startDate || null, p_fim: options.endDate || null, p_page: options.page, p_page_size: pageSize });
  if (error) fail("STOCK_MOVEMENTS_LIST_FAILED", error.code);
  const movements = (data ?? []) as StockMovement[];
  return { movements, total: Number(movements[0]?.total_count ?? 0), pageSize };
}

export async function getStockSummary(): Promise<StockSummary> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_stock_summary");
  if (error) fail("STOCK_SUMMARY_LOAD_FAILED", error.code);
  return ((data ?? [])[0] as StockSummary | undefined) ?? { total_ativos: 0, estoque_baixo: 0, vencendo: 0, vencidos: 0 };
}

export async function getStockMaterial(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("materiais_estoque").select("id,nome,categoria,unidade,quantidade_atual,estoque_minimo,validade,fornecedor,ativo").eq("id", id).maybeSingle();
  if (error) fail("STOCK_MATERIAL_LOAD_FAILED", error.code);
  return data as Omit<StockMaterial, "estoque_baixo" | "vencendo" | "vencido" | "total_count"> | null;
}
