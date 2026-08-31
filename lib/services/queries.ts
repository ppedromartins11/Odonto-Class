import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinalizationPreviewItem, Service, ServiceMaterial, ServiceStatus } from "./types";

function fail(scope: string, code?: string): never {
  console.error(scope, { code });
  throw new Error(scope);
}

export async function listServices(options: { query?: string; status?: ServiceStatus; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient();
  const pageSize = options.pageSize ?? 20;
  const { data, error } = await supabase.rpc("list_services", {
    p_query: options.query || null,
    p_status: options.status || null,
    p_page: options.page,
    p_page_size: pageSize,
  });
  if (error) fail("SERVICES_LIST_FAILED", error.code);
  const services = (data ?? []) as Service[];
  return { services, total: Number(services[0]?.total_count ?? 0), pageSize };
}

export async function getService(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("servicos")
    .select("id,nome,descricao,categoria,valor_padrao_centavos,ativo")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("SERVICE_LOAD_FAILED", error.code);
  return data as Omit<Service, "total_count"> | null;
}

export async function listServiceMaterials(serviceId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_service_materials", { p_servico_id: serviceId });
  if (error) fail("SERVICE_MATERIALS_LIST_FAILED", error.code);
  return (data ?? []) as ServiceMaterial[];
}

export async function getFinalizationPreview(attendanceId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_attendance_finalization", { p_atendimento_id: attendanceId });
  if (error) fail("ATTENDANCE_FINALIZATION_PREVIEW_FAILED", error.code);
  return (data ?? []) as FinalizationPreviewItem[];
}
