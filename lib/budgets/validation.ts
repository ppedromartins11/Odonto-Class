import type { BudgetStatus } from "./types";

export const BUDGET_STATUSES: BudgetStatus[] = ["rascunho", "enviado", "aprovado", "rejeitado", "expirado", "convertido"];

export function isBudgetStatus(value: string): value is BudgetStatus {
  return BUDGET_STATUSES.includes(value as BudgetStatus);
}

export function parseCents(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100_000_000 ? parsed : null;
}

export function formatCents(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}
