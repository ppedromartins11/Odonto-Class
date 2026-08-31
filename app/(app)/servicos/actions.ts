"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { parseCents, parsePositiveInteger } from "@/lib/services/validation";
import type { ServiceActionState } from "@/lib/services/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const result = (error: string | null, fieldErrors?: Record<string, string>): ServiceActionState => ({ success: !error, error, fieldErrors });
const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function readService(formData: FormData) {
  const name = clean(formData.get("nome"));
  const description = clean(formData.get("descricao"));
  const category = clean(formData.get("categoria"));
  const cents = parseCents(formData.get("valorPadrao"));
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 200) fieldErrors.nome = "Informe um nome entre 2 e 200 caracteres.";
  if (description.length > 1000) fieldErrors.descricao = "Use no máximo 1.000 caracteres.";
  if (category && (category.length < 2 || category.length > 100)) fieldErrors.categoria = "Use entre 2 e 100 caracteres.";
  if (cents === null) fieldErrors.valorPadrao = "Informe um valor válido.";
  return { name, description: description || null, category: category || null, cents, fieldErrors };
}

export async function createService(_: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const user = await requireUser();
  if (user.perfil !== "administrador") return result("Ação não autorizada.");
  const input = readService(formData);
  if (Object.keys(input.fieldErrors).length || input.cents === null) return result("Revise os dados do serviço.", input.fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_service", { p_nome: input.name, p_descricao: input.description, p_categoria: input.category, p_valor_padrao_centavos: input.cents });
  if (error || !data) return result("Não foi possível criar o serviço.");
  redirect(`/servicos/${(data as { id: string }).id}`);
}

export async function updateService(_: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const user = await requireUser();
  const serviceId = clean(formData.get("serviceId"));
  if (user.perfil !== "administrador" || !isValidUuid(serviceId)) return result("Ação não autorizada.");
  const input = readService(formData);
  if (Object.keys(input.fieldErrors).length || input.cents === null) return result("Revise os dados do serviço.", input.fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_service", { p_servico_id: serviceId, p_nome: input.name, p_descricao: input.description, p_categoria: input.category, p_valor_padrao_centavos: input.cents });
  if (error) return result("Não foi possível atualizar o serviço.");
  revalidatePath("/servicos"); revalidatePath(`/servicos/${serviceId}`);
  return result(null);
}

export async function setServiceActive(_: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const user = await requireUser(); const serviceId = clean(formData.get("serviceId")); const active = clean(formData.get("ativo"));
  if (user.perfil !== "administrador" || !isValidUuid(serviceId) || !["true", "false"].includes(active)) return result("Ação não autorizada.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_service_active", { p_servico_id: serviceId, p_ativo: active === "true" });
  if (error) return result("Não foi possível alterar o status do serviço.");
  revalidatePath("/servicos"); revalidatePath(`/servicos/${serviceId}`); return result(null);
}

export async function configureServiceMaterial(_: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const user = await requireUser(); const serviceId = clean(formData.get("serviceId")); const materialId = clean(formData.get("materialId")); const quantity = parsePositiveInteger(formData.get("quantidade"));
  if (user.perfil !== "administrador" || !isValidUuid(serviceId) || !isValidUuid(materialId) || quantity === null) return result("Revise os dados do material.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("configure_service_material", { p_servico_id: serviceId, p_material_id: materialId, p_quantidade_padrao: quantity, p_ativo: true });
  if (error) return result("Não foi possível salvar a composição. Verifique se o material está ativo.");
  revalidatePath(`/servicos/${serviceId}`); return result(null);
}

export async function setServiceMaterialActive(_: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const user = await requireUser(); const serviceId = clean(formData.get("serviceId")); const id = clean(formData.get("serviceMaterialId")); const active = clean(formData.get("ativo"));
  if (user.perfil !== "administrador" || !isValidUuid(serviceId) || !isValidUuid(id) || !["true", "false"].includes(active)) return result("Ação não autorizada.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_service_material_active", { p_servico_material_id: id, p_ativo: active === "true" });
  if (error) return result("Não foi possível alterar a composição.");
  revalidatePath(`/servicos/${serviceId}`); return result(null);
}
