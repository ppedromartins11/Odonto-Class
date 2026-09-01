"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DomainActionState } from "@/lib/validity/types";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const state = (error: string | null): DomainActionState => ({ success: !error, error });

export async function createEquipment(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada.");
  const name = clean(form.get("nome")); const identification = clean(form.get("identificacao")); if (name.length < 2 || identification.length < 2) return state("Informe nome e identificação do equipamento.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("create_sterilization_equipment", { p_nome: name, p_identificacao: identification, p_modelo: clean(form.get("modelo")) || null, p_fabricante: clean(form.get("fabricante")) || null, p_numero_serie: clean(form.get("numeroSerie")) || null });
  if (error) return state("Não foi possível cadastrar o equipamento. Confira a identificação."); revalidatePath("/esterilizacao"); return state(null);
}

export async function setEquipmentActive(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada."); const id = clean(form.get("equipmentId")); if (!isValidUuid(id)) return state("Equipamento inválido.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_sterilization_equipment_active", { p_equipamento_id: id, p_ativo: clean(form.get("active")) === "true" });
  if (error) return state("Não foi possível alterar o equipamento. Verifique ciclos em andamento."); revalidatePath("/esterilizacao"); return state(null);
}

export async function updateEquipment(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil !== "administrador") return state("Ação não autorizada.");
  const id = clean(form.get("equipmentId")); const name = clean(form.get("nome")); const identification = clean(form.get("identificacao"));
  const model = clean(form.get("modelo")); const manufacturer = clean(form.get("fabricante")); const serialNumber = clean(form.get("numeroSerie"));
  if (!isValidUuid(id) || name.length < 2 || name.length > 150 || identification.length < 2 || identification.length > 100 || model.length > 120 || manufacturer.length > 120 || serialNumber.length > 120) return state("Revise os dados do equipamento.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("update_sterilization_equipment", { p_equipamento_id: id, p_nome: name, p_identificacao: identification, p_modelo: model || null, p_fabricante: manufacturer || null, p_numero_serie: serialNumber || null });
  if (error) return state(error.code === "23505" ? "Já existe um equipamento com essa identificação." : "Não foi possível atualizar o equipamento.");
  revalidatePath("/esterilizacao"); return state(null);
}

export async function startCycle(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil === "dentista") return state("Ação não autorizada."); const equipmentId = clean(form.get("equipmentId")); if (!isValidUuid(equipmentId)) return state("Selecione um equipamento.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("start_sterilization_cycle", { p_equipamento_id: equipmentId, p_observacoes: clean(form.get("observacoes")) || null });
  if (error) return state("Não foi possível iniciar o ciclo."); revalidatePath("/esterilizacao"); return state(null);
}

export async function createPackage(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil === "dentista") return state("Ação não autorizada."); const cycleId = clean(form.get("cycleId")); const validity = clean(form.get("validade"));
  if (!isValidUuid(cycleId) || !/^\d{4}-\d{2}-\d{2}$/.test(validity)) return state("Revise os dados do pacote.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("create_sterilization_package", { p_ciclo_id: cycleId, p_codigo: clean(form.get("codigo")), p_descricao: clean(form.get("descricao")), p_validade_ate: validity });
  if (error) return state("Não foi possível criar o pacote. Confira código, validade e status do ciclo."); revalidatePath("/esterilizacao"); revalidatePath(`/esterilizacao/${cycleId}`); return state(null);
}

export async function finishCycle(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil === "dentista") return state("Ação não autorizada."); const cycleId = clean(form.get("cycleId")); const status = clean(form.get("status")); if (!isValidUuid(cycleId) || !["concluido","reprovado","cancelado"].includes(status)) return state("Ciclo inválido.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("finish_sterilization_cycle", { p_ciclo_id: cycleId, p_status: status, p_observacoes: clean(form.get("observacoes")) || null });
  if (error) return state("Não foi possível finalizar o ciclo. Confira as validades dos pacotes."); revalidatePath("/esterilizacao"); revalidatePath(`/esterilizacao/${cycleId}`); return state(null);
}

export async function setPackageStatus(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser(); if (user.perfil === "dentista") return state("Ação não autorizada."); const packageId = clean(form.get("packageId")); const cycleId = clean(form.get("cycleId")); const status = clean(form.get("status")); if (!isValidUuid(packageId) || !["utilizado","descartado"].includes(status)) return state("Pacote inválido.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_sterilization_package_status", { p_pacote_id: packageId, p_status: status });
  if (error) return state("Não foi possível alterar o pacote. Pacotes vencidos não podem ser utilizados."); revalidatePath("/esterilizacao"); if (isValidUuid(cycleId)) revalidatePath(`/esterilizacao/${cycleId}`); return state(null);
}
