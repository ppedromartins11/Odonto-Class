import { SERVICE_STATUSES, type ServiceStatus } from "./types";

export function isServiceStatus(value: string): value is ServiceStatus {
  return SERVICE_STATUSES.includes(value as ServiceStatus);
}

export function parsePositiveInteger(value: FormDataEntryValue | null, max = 1_000_000) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

export function parseCents(value: FormDataEntryValue | null, max = 100_000_000) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= max ? cents : null;
}

export function formatCents(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}
