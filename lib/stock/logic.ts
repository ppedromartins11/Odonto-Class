import type { StockMovementType } from "./types";

export function calculateStockBalance(current: number, type: StockMovementType, quantity: number): number | null {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(quantity)) return null;
  if (type === "ajuste") return quantity >= 0 ? quantity : null;
  if (quantity <= 0) return null;
  const result = type === "entrada" ? current + quantity : current - quantity;
  return result >= 0 && result <= 1_000_000 ? result : null;
}

export function stockAlerts(input: { active: boolean; quantity: number; minimum: number; validity: string | null; today: string }) {
  const threshold = new Date(`${input.today}T00:00:00Z`); threshold.setUTCDate(threshold.getUTCDate() + 30);
  const expiringLimit = threshold.toISOString().slice(0, 10);
  return {
    low: input.active && input.quantity <= input.minimum,
    expired: input.active && Boolean(input.validity && input.validity < input.today),
    expiring: input.active && Boolean(input.validity && input.validity >= input.today && input.validity <= expiringLimit),
  };
}
