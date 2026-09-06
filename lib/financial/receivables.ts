export type ReceivableStatus = "pendente" | "parcialmente_pago" | "pago" | "cancelado";
export type InstallmentStatus = "pendente" | "paga" | "cancelada";

export function splitInstallments(totalCents: number, count: number) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || !Number.isSafeInteger(count) || count < 1 || count > 120) {
    return null;
  }
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function receivableStatus(totalCents: number, paidCents: number, cancelled = false): ReceivableStatus {
  if (cancelled) return "cancelado";
  if (paidCents <= 0) return "pendente";
  if (paidCents < totalCents) return "parcialmente_pago";
  return "pago";
}

export function installmentVisualStatus(status: InstallmentStatus, dueDate: string, today: string): "pendente" | "paga" | "cancelada" | "vencida" {
  if (status !== "pendente") return status;
  return dueDate < today ? "vencida" : "pendente";
}
