export type TreatmentPlanItemState = "planejado" | "em_andamento" | "realizado" | "cancelado";

export type TreatmentPlanItemProgress = {
  plannedQuantity: number;
  linkedInProgressQuantity: number;
  finalizedQuantity: number;
  cancelled: boolean;
};

export function getTreatmentPlanItemState(item: TreatmentPlanItemProgress): TreatmentPlanItemState {
  if (item.cancelled) return "cancelado";
  if (item.finalizedQuantity >= item.plannedQuantity) return "realizado";
  if (item.finalizedQuantity > 0 || item.linkedInProgressQuantity > 0) return "em_andamento";
  return "planejado";
}

export type TreatmentPlanProgress = {
  totalItems: number;
  completedItems: number;
  cancelledItems: number;
};

export function getTreatmentPlanProgress(progress: TreatmentPlanProgress) {
  const denominator = Math.max(progress.totalItems - progress.cancelledItems, 0);
  const completedItems = Math.min(Math.max(progress.completedItems, 0), denominator);
  return {
    denominator,
    completedItems,
    percent: denominator === 0 ? 0 : Math.round((completedItems / denominator) * 100),
  };
}

export function isBudgetEligibleForConversion(input: {
  status: "aprovado" | "convertido" | "rascunho" | "enviado" | "rejeitado" | "expirado";
  patientActive: boolean;
  activeItems: number;
  itemsTotalCents: number;
  budgetTotalCents: number;
}) {
  return input.status === "aprovado"
    && input.patientActive
    && input.activeItems > 0
    && input.itemsTotalCents === input.budgetTotalCents;
}
