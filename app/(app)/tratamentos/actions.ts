"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TreatmentPlanActionState } from "@/lib/treatments/types";

function actionError(code?: string) {
  if (code === "42501") return "Você não tem permissão para executar esta ação.";
  if (code === "P0002") return "O orçamento ou plano não foi encontrado.";
  if (code === "23514") return "Esta ação não é permitida para o estado atual. O plano pode já ter sido convertido, iniciado ou cancelado.";
  return "Não foi possível concluir a operação. Tente novamente.";
}

export async function convertBudgetToTreatmentPlan(_: TreatmentPlanActionState, formData: FormData): Promise<TreatmentPlanActionState> {
  const user = await requireUser();
  const budgetId = String(formData.get("budgetId") ?? "");
  if (!isValidUuid(budgetId)) return { success: false, error: "Orçamento inválido." };
  if (user.perfil !== "administrador" && user.perfil !== "dentista") return { success: false, error: "Você não tem permissão para converter este orçamento." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("convert_budget_to_treatment_plan", { p_orcamento_id: budgetId });
  if (error || !data) return { success: false, error: actionError(error?.code) };
  const plan = data as { id: string; paciente_id: string };
  const planId = plan.id;
  revalidatePath("/orcamentos"); revalidatePath(`/orcamentos/${budgetId}`); revalidatePath(`/pacientes/${plan.paciente_id}`); revalidatePath(`/tratamentos/${planId}`);
  return { success: true, error: null, planId };
}

export async function cancelTreatmentPlan(_: TreatmentPlanActionState, formData: FormData): Promise<TreatmentPlanActionState> {
  const user = await requireUser();
  const planId = String(formData.get("planId") ?? "");
  if (!isValidUuid(planId)) return { success: false, error: "Plano inválido." };
  if (user.perfil !== "administrador") return { success: false, error: "Você não tem permissão para cancelar este plano." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("cancel_treatment_plan", { p_plano_tratamento_id: planId });
  if (error || !data) return { success: false, error: actionError(error?.code) };
  const plan = data as { paciente_id: string; orcamento_id: string };
  revalidatePath(`/tratamentos/${planId}`); revalidatePath(`/orcamentos/${plan.orcamento_id}`); revalidatePath(`/pacientes/${plan.paciente_id}`);
  return { success: true, error: null, planId };
}
