"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isStockMovementType, isStockUnit, isValidIsoDate, parseStockQuantity } from "@/lib/stock/validation";
import type { StockActionState } from "@/lib/stock/types";

const result = (error: string | null, fieldErrors?: Record<string, string>): StockActionState => ({ success: !error, error, fieldErrors });
const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function readMaterial(form: FormData, requireInitial: boolean) {
  const nome = clean(form.get("nome")); const categoria = clean(form.get("categoria"));
  const unidade = clean(form.get("unidade")); const minimo = parseStockQuantity(form.get("estoqueMinimo"));
  const initial = parseStockQuantity(form.get("quantidadeInicial")); const validade = clean(form.get("validade")); const fornecedor = clean(form.get("fornecedor"));
  const errors: Record<string, string> = {};
  if (nome.length < 2 || nome.length > 200) errors.nome = "Informe um nome entre 2 e 200 caracteres.";
  if (categoria.length < 2 || categoria.length > 100) errors.categoria = "Informe uma categoria entre 2 e 100 caracteres.";
  if (!isStockUnit(unidade)) errors.unidade = "Selecione uma unidade válida.";
  if (minimo === null) errors.estoqueMinimo = "Informe um estoque mínimo entre 0 e 1.000.000.";
  if (requireInitial && initial === null) errors.quantidadeInicial = "Informe uma quantidade entre 0 e 1.000.000.";
  if (validade && !isValidIsoDate(validade)) errors.validade = "Informe uma validade válida.";
  if (fornecedor.length > 0 && (fornecedor.length < 2 || fornecedor.length > 200)) errors.fornecedor = "Use entre 2 e 200 caracteres.";
  return { errors, nome, categoria, unidade, minimo, initial, validade: validade || null, fornecedor: fornecedor || null };
}

export async function createStockMaterial(_: StockActionState, form: FormData): Promise<StockActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return result("Ação não autorizada.");
  const data = readMaterial(form, true); if (Object.keys(data.errors).length) return result("Revise os dados do material.", data.errors);
  const supabase = await createSupabaseServerClient();
  const { data: material, error } = await supabase.rpc("create_stock_material", { p_nome: data.nome, p_categoria: data.categoria, p_unidade: data.unidade, p_quantidade_inicial: data.initial, p_estoque_minimo: data.minimo, p_validade: data.validade, p_fornecedor: data.fornecedor, p_ativo: form.get("ativo") === "true" });
  if (error || !material) return result("Não foi possível criar o material.");
  const id = (material as { id: string }).id;
  revalidatePath("/estoque"); revalidatePath("/estoque/movimentacoes"); redirect(`/estoque/${id}`);
}

export async function updateStockMaterial(_: StockActionState, form: FormData): Promise<StockActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return result("Ação não autorizada.");
  const id = clean(form.get("materialId")); if (!isValidUuid(id)) return result("Material inválido.");
  const data = readMaterial(form, false); if (Object.keys(data.errors).length) return result("Revise os dados do material.", data.errors);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_stock_material", { p_material_id: id, p_nome: data.nome, p_categoria: data.categoria, p_unidade: data.unidade, p_estoque_minimo: data.minimo, p_validade: data.validade, p_fornecedor: data.fornecedor });
  if (error) return result("Não foi possível atualizar o material.");
  revalidatePath("/estoque"); revalidatePath(`/estoque/${id}`); return result(null);
}

export async function registerStockMovement(_: StockActionState, form: FormData): Promise<StockActionState> {
  const user = await requireUser(); const materialId = clean(form.get("materialId")); const type = clean(form.get("tipo")); const quantity = parseStockQuantity(form.get("quantidade"), type === "ajuste"); const motive = clean(form.get("motivo"));
  if (!isValidUuid(materialId) || !isStockMovementType(type) || quantity === null) return result("Revise os dados da movimentação.");
  if (type === "entrada" && user.perfil === "dentista") return result("Entrada não autorizada.");
  if (type === "ajuste" && user.perfil !== "administrador") return result("Ajuste não autorizado.");
  if ((type === "ajuste" || (type === "saida" && user.perfil === "dentista")) && motive.length < 2) return result("Informe o motivo da movimentação.", { motivo: "Motivo obrigatório." });
  if (motive.length > 500 || clean(form.get("referencia")).length > 120) return result("Revise os textos informados.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: type, p_quantidade: quantity, p_motivo: motive || null, p_referencia: clean(form.get("referencia")) || null });
  if (error) return result("Não foi possível registrar a movimentação. Confira o saldo e tente novamente.");
  revalidatePath("/estoque"); revalidatePath(`/estoque/${materialId}`); revalidatePath("/estoque/movimentacoes"); return result(null);
}

export async function setStockMaterialActive(_: StockActionState, form: FormData): Promise<StockActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return result("Ação não autorizada.");
  const id = clean(form.get("materialId")); const active = clean(form.get("ativo")); if (!isValidUuid(id) || (active !== "true" && active !== "false")) return result("Material inválido.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_stock_material_active", { p_material_id: id, p_ativo: active === "true" });
  if (error) return result("Não foi possível alterar o status do material.");
  revalidatePath("/estoque"); revalidatePath(`/estoque/${id}`); return result(null);
}
