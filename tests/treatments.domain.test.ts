import { describe, expect, it } from "vitest";
import { getTreatmentPlanItemState, getTreatmentPlanProgress, isBudgetEligibleForConversion } from "../lib/treatments/domain";

describe("treatment plan domain", () => {
  it("derives item state from clinical evidence instead of a mutable flag", () => {
    expect(getTreatmentPlanItemState({ plannedQuantity: 2, linkedInProgressQuantity: 0, finalizedQuantity: 0, cancelled: false })).toBe("planejado");
    expect(getTreatmentPlanItemState({ plannedQuantity: 2, linkedInProgressQuantity: 1, finalizedQuantity: 0, cancelled: false })).toBe("em_andamento");
    expect(getTreatmentPlanItemState({ plannedQuantity: 2, linkedInProgressQuantity: 0, finalizedQuantity: 2, cancelled: false })).toBe("realizado");
    expect(getTreatmentPlanItemState({ plannedQuantity: 2, linkedInProgressQuantity: 2, finalizedQuantity: 2, cancelled: true })).toBe("cancelado");
  });

  it("calculates progress without cancelled items in the denominator", () => {
    expect(getTreatmentPlanProgress({ totalItems: 5, completedItems: 2, cancelledItems: 1 })).toEqual({ denominator: 4, completedItems: 2, percent: 50 });
    expect(getTreatmentPlanProgress({ totalItems: 1, completedItems: 0, cancelledItems: 1 })).toEqual({ denominator: 0, completedItems: 0, percent: 0 });
  });

  it("accepts only internally consistent approved budgets", () => {
    expect(isBudgetEligibleForConversion({ status: "aprovado", patientActive: true, activeItems: 1, itemsTotalCents: 1000, budgetTotalCents: 1000 })).toBe(true);
    expect(isBudgetEligibleForConversion({ status: "convertido", patientActive: true, activeItems: 1, itemsTotalCents: 1000, budgetTotalCents: 1000 })).toBe(false);
    expect(isBudgetEligibleForConversion({ status: "aprovado", patientActive: false, activeItems: 1, itemsTotalCents: 1000, budgetTotalCents: 1000 })).toBe(false);
    expect(isBudgetEligibleForConversion({ status: "aprovado", patientActive: true, activeItems: 0, itemsTotalCents: 0, budgetTotalCents: 0 })).toBe(false);
  });
});
