"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DomainActionState } from "@/lib/validity/types";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const state = (error: string | null, fieldErrors?: Record<string, string>): DomainActionState => ({ success: !error, error, fieldErrors });
const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T12:00:00Z"));
const quantity = (value: FormDataEntryValue | null) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : null; };
const nonNegativeQuantity = (value: FormDataEntryValue | null) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : null; };

export async function setLotControl(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada.");
  const materialId = clean(form.get("materialId")); const enabled = clean(form.get("enabled")) === "true";
  const code = clean(form.get("codigoLote")); const validity = clean(form.get("validade")); const manufacture = clean(form.get("fabricacao")); const supplier = clean(form.get("fornecedor"));
  if (!isValidUuid(materialId)) return state("Material inválido.");
  if (enabled && validity && !isoDate(validity)) return state("Informe uma validade válida.", { validade: "Data inválida." });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_stock_lot_control", { p_material_id: materialId, p_controla: enabled, p_codigo_lote_inicial: code || null, p_data_validade: validity || null, p_data_fabricacao: manufacture || null, p_fornecedor: supplier || null });
  if (error) return state(error.message.includes("lote inicial") ? "Informe o lote inicial para representar o saldo físico atual." : "Não foi possível alterar o controle por lote. Confira o saldo e os lotes existentes.");
  revalidatePath("/estoque"); revalidatePath(`/estoque/${materialId}`); revalidatePath("/validade"); return state(null);
}

export async function registerLotEntry(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil === "dentista") return state("Entrada por lote não autorizada.");
  const materialId = clean(form.get("materialId")); const code = clean(form.get("codigoLote")); const amount = quantity(form.get("quantidade")); const validity = clean(form.get("validade")); const manufacture = clean(form.get("fabricacao")); const supplier = clean(form.get("fornecedor"));
  if (!isValidUuid(materialId) || !code || amount === null || !isoDate(validity) || (manufacture && !isoDate(manufacture))) return state("Revise os dados do lote.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("register_stock_lot_entry", { p_material_id: materialId, p_codigo_lote: code, p_quantidade: amount, p_data_validade: validity, p_data_fabricacao: manufacture || null, p_fornecedor: supplier || null, p_motivo: clean(form.get("motivo")) || null, p_referencia: clean(form.get("referencia")) || null });
  if (error) return state("Não foi possível registrar a entrada. Verifique o controle por lote e os metadados do lote existente.");
  revalidatePath("/validade"); revalidatePath("/estoque"); revalidatePath(`/estoque/${materialId}`); return state(null);
}

export async function registerLotExit(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil === "dentista") return state("Saída por lote não autorizada.");
  const materialId = clean(form.get("materialId")); const lotId = clean(form.get("lotId")); const amount = quantity(form.get("quantidade")); const purpose = clean(form.get("finalidade")); const motive = clean(form.get("motivo"));
  if (!isValidUuid(materialId) || !isValidUuid(lotId) || amount === null || !["uso","descarte","perda"].includes(purpose)) return state("Revise os dados da saída.");
  if ((purpose === "descarte" || purpose === "perda") && motive.length < 2) return state("Informe o motivo do descarte ou perda.", { motivo: "Motivo obrigatório." });
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("register_stock_lot_exit", { p_material_id: materialId, p_lote_id: lotId, p_quantidade: amount, p_finalidade: purpose, p_motivo: motive || null, p_referencia: clean(form.get("referencia")) || null });
  if (error) return state(error.message.includes("vencido") ? "Lote vencido não pode ser usado. Registre descarte ou perda com motivo." : "Não foi possível registrar a saída. Confira o saldo do lote.");
  revalidatePath("/validade"); revalidatePath(`/validade/${lotId}`); revalidatePath("/estoque"); return state(null);
}

export async function setLotActive(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada.");
  const lotId = clean(form.get("lotId")); const active = clean(form.get("active")) === "true"; if (!isValidUuid(lotId)) return state("Lote inválido.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_stock_lot_active", { p_lote_id: lotId, p_ativo: active });
  if (error) return state("Não foi possível alterar o lote. Lotes com saldo não podem ser inativados.");
  revalidatePath("/validade"); revalidatePath(`/validade/${lotId}`); return state(null);
}

export async function updateLotMetadata(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada.");
  const lotId = clean(form.get("lotId")); const code = clean(form.get("codigoLote")); const validity = clean(form.get("validade")); const manufacture = clean(form.get("fabricacao"));
  if (!isValidUuid(lotId) || !code || !isoDate(validity) || (manufacture && !isoDate(manufacture))) return state("Revise os metadados do lote.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("update_stock_lot_metadata", { p_lote_id: lotId, p_codigo_lote: code, p_data_validade: validity, p_data_fabricacao: manufacture || null, p_fornecedor: clean(form.get("fornecedor")) || null });
  if (error) return state("Não foi possível corrigir o lote. Confira código, datas e duplicidade.");
  revalidatePath("/validade"); revalidatePath(`/validade/${lotId}`); return state(null);
}

export async function adjustLotStock(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada.");
  const lotId = clean(form.get("lotId")); const materialId = clean(form.get("materialId")); const amount = nonNegativeQuantity(form.get("quantidade")); const motive = clean(form.get("motivo"));
  if (!isValidUuid(lotId) || !isValidUuid(materialId) || amount === null || motive.length < 2) return state("Informe a nova contagem e o motivo do ajuste.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("adjust_stock_lot", { p_material_id: materialId, p_lote_id: lotId, p_nova_quantidade: amount, p_motivo: motive, p_referencia: clean(form.get("referencia")) || null });
  if (error) return state("Não foi possível ajustar o lote. Confira a contagem e o saldo agregado.");
  revalidatePath("/validade"); revalidatePath(`/validade/${lotId}`); revalidatePath(`/estoque/${materialId}`); return state(null);
}
