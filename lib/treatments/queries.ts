import "server-only";
import type { UsuarioAtual } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FdiTooth } from "@/lib/odontogram/fdi";
import { getTreatmentPlanProgress } from "./domain";
import type { AvailableTreatmentPlanItem, TreatmentPlanClinicalItem, TreatmentPlanDetail, TreatmentPlanProcedure, TreatmentPlanStatus, TreatmentPlanSummary } from "./types";

type PlanRow = { id: string; paciente_id: string; orcamento_id: string; profissional_id: string; status: TreatmentPlanStatus; created_at: string; cancelado_em: string | null };
type ItemRow = { id: string; plano_tratamento_id: string; descricao_snapshot: string; quantidade_planejada: number; status: TreatmentPlanClinicalItem["status"] };

function fail(scope: string, code?: string): never { console.error(scope, { code }); throw new Error(scope); }

function summaryFrom(plan: PlanRow, items: Array<Pick<ItemRow, "status">>): TreatmentPlanSummary {
  const progress = getTreatmentPlanProgress({ totalItems: items.length, completedItems: items.filter((item) => item.status === "realizado").length, cancelledItems: items.filter((item) => item.status === "cancelado").length });
  return { id: plan.id, paciente_id: plan.paciente_id, orcamento_id: plan.orcamento_id, profissional_id: plan.profissional_id, status: plan.status, created_at: plan.created_at, cancelled_at: plan.cancelado_em, total_items: items.length, completed_items: progress.completedItems, progress_percent: progress.percent };
}

async function administrativeItems(planIds: string[]) {
  if (planIds.length === 0) return [] as ItemRow[];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("plano_tratamento_itens").select("id,plano_tratamento_id,status").in("plano_tratamento_id", planIds);
  if (error) fail("TREATMENT_PLAN_ADMIN_SUMMARY_FAILED", error.code);
  return (data ?? []) as ItemRow[];
}

async function ownClinicalItems(planId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("plano_tratamento_itens").select("id,plano_tratamento_id,descricao_snapshot,quantidade_planejada,status").eq("plano_tratamento_id", planId).order("ordem");
  if (error) fail("TREATMENT_PLAN_ITEMS_LOAD_FAILED", error.code);
  return (data ?? []) as ItemRow[];
}

async function ownClinicalItemsForPlans(planIds: string[]) {
  if (planIds.length === 0) return [] as ItemRow[];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plano_tratamento_itens")
    .select("id,plano_tratamento_id,descricao_snapshot,quantidade_planejada,status")
    .in("plano_tratamento_id", planIds)
    .order("ordem");
  if (error) fail("TREATMENT_PLAN_ITEMS_LOAD_FAILED", error.code);
  return (data ?? []) as ItemRow[];
}

async function ownPlanProcedures(itemIds: string[]) {
  if (itemIds.length === 0) return [] as Array<{ plano_tratamento_item_id: string; procedure: TreatmentPlanProcedure }>;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("procedimentos").select("id,atendimento_id,quantidade,plano_tratamento_item_id,procedimento_dentes(dente_fdi),atendimentos!inner(status)").in("plano_tratamento_item_id", itemIds);
  if (error) fail("TREATMENT_PLAN_PROCEDURES_LOAD_FAILED", error.code);
  return (data ?? []).map((row) => {
    const teethRows = Array.isArray(row.procedimento_dentes) ? row.procedimento_dentes as Array<{ dente_fdi?: number }> : [];
    const attendance = Array.isArray(row.atendimentos) ? row.atendimentos[0] : row.atendimentos;
    return {
      plano_tratamento_item_id: String(row.plano_tratamento_item_id),
      procedure: { id: String(row.id), atendimento_id: String(row.atendimento_id), quantidade: Number(row.quantidade), attendance_status: (attendance?.status ?? "em_andamento") as TreatmentPlanProcedure["attendance_status"], teeth: teethRows.map((tooth) => tooth.dente_fdi).filter((tooth): tooth is FdiTooth => typeof tooth === "number").sort((a, b) => a - b) },
    };
  });
}

export async function getTreatmentPlanByBudget(budgetId: string, user: UsuarioAtual): Promise<TreatmentPlanSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("planos_tratamento").select("id,paciente_id,orcamento_id,profissional_id,status,created_at,cancelado_em").eq("orcamento_id", budgetId).maybeSingle();
  if (error) fail("TREATMENT_PLAN_BY_BUDGET_FAILED", error.code);
  if (!data) return null;
  const plan = data as PlanRow;
  const items = user.perfil === "dentista"
    ? await ownClinicalItems(plan.id)
    : await administrativeItems([plan.id]);
  return summaryFrom(plan, items);
}

export async function getTreatmentPlan(id: string, user: UsuarioAtual): Promise<TreatmentPlanDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("planos_tratamento").select("id,paciente_id,orcamento_id,profissional_id,status,created_at,cancelado_em").eq("id", id).maybeSingle();
  if (error) fail("TREATMENT_PLAN_LOAD_FAILED", error.code);
  if (!data) return null;
  const plan = data as PlanRow;
  if (user.perfil !== "dentista") {
    const items = await administrativeItems([plan.id]);
    return summaryFrom(plan, items);
  }
  const items = await ownClinicalItems(plan.id);
  const procedures = await ownPlanProcedures(items.map((item) => item.id));
  const clinicalItems: TreatmentPlanClinicalItem[] = items.map((item) => {
    const linked = procedures.filter((procedure) => procedure.plano_tratamento_item_id === item.id).map((procedure) => procedure.procedure);
    const executed = linked.reduce((sum, procedure) => sum + procedure.quantidade, 0);
    return { id: item.id, descricao_snapshot: item.descricao_snapshot, quantidade_planejada: item.quantidade_planejada, quantidade_executada: executed, quantidade_restante: Math.max(item.quantidade_planejada - executed, 0), status: item.status, procedures: linked };
  });
  return { ...summaryFrom(plan, items), clinical_items: clinicalItems };
}

export async function listTreatmentPlansForPatient(patientId: string, user: UsuarioAtual) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("planos_tratamento").select("id,paciente_id,orcamento_id,profissional_id,status,created_at,cancelado_em").eq("paciente_id", patientId).order("created_at", { ascending: false }).limit(50);
  if (error) fail("PATIENT_TREATMENT_PLANS_LOAD_FAILED", error.code);
  const plans = (data ?? []) as PlanRow[];
  const items = user.perfil === "dentista"
    ? await ownClinicalItemsForPlans(plans.map((plan) => plan.id))
    : await administrativeItems(plans.map((plan) => plan.id));
  return plans.map((plan) => summaryFrom(plan, items.filter((item) => item.plano_tratamento_id === plan.id)));
}

export async function listAvailableTreatmentPlanItemsForAttendance(attendanceId: string): Promise<AvailableTreatmentPlanItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data: attendance, error: attendanceError } = await supabase.from("atendimentos").select("paciente_id,profissional_id,status").eq("id", attendanceId).maybeSingle();
  if (attendanceError) fail("ATTENDANCE_TREATMENT_ITEMS_LOAD_FAILED", attendanceError.code);
  if (!attendance || attendance.status !== "em_andamento") return [];
  const { data: plans, error: planError } = await supabase.from("planos_tratamento").select("id").eq("paciente_id", attendance.paciente_id).eq("profissional_id", attendance.profissional_id).in("status", ["planejado", "em_andamento"]);
  if (planError) fail("ATTENDANCE_TREATMENT_PLANS_LOAD_FAILED", planError.code);
  const planIds = (plans ?? []).map((plan) => plan.id);
  if (planIds.length === 0) return [];
  const { data: items, error: itemError } = await supabase.from("plano_tratamento_itens").select("id,descricao_snapshot,quantidade_planejada,status").in("plano_tratamento_id", planIds).in("status", ["planejado", "em_andamento"]).order("ordem");
  if (itemError) fail("ATTENDANCE_TREATMENT_ITEMS_LOAD_FAILED", itemError.code);
  const typedItems = (items ?? []) as Array<Pick<ItemRow, "id" | "descricao_snapshot" | "quantidade_planejada" | "status">>;
  const procedures = await ownPlanProcedures(typedItems.map((item) => item.id));
  return typedItems.map((item) => ({ id: item.id, descricao_snapshot: item.descricao_snapshot, quantidade_restante: Math.max(item.quantidade_planejada - procedures.filter((procedure) => procedure.plano_tratamento_item_id === item.id).reduce((sum, procedure) => sum + procedure.procedure.quantidade, 0), 0) })).filter((item) => item.quantidade_restante > 0);
}
