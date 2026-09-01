import type { CycleStatus, PackageEffectiveStatus, PackageStatus, ValidityStatus } from "./types";

const DAY_MS = 86_400_000;

function utcDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(time);
  if (date.toISOString().slice(0, 10) !== value) return null;
  return time;
}

export function daysUntil(date: string, today: string) {
  const target = utcDay(date);
  const base = utcDay(today);
  return target === null || base === null ? null : Math.round((target - base) / DAY_MS);
}

export function validityStatus(input: { quantity: number; active: boolean; validity: string; today: string }): ValidityStatus | null {
  const days = daysUntil(input.validity, input.today);
  if (days === null || !Number.isInteger(input.quantity) || input.quantity < 0) return null;
  if (!input.active) return "inativo";
  if (input.quantity === 0) return "esgotado";
  if (days < 0) return "vencido";
  if (days <= 30) return "proximo_do_vencimento";
  return "valido";
}

export function packageEffectiveStatus(input: { status: PackageStatus; validity: string; today: string }): PackageEffectiveStatus | null {
  if (input.status === "utilizado" || input.status === "descartado" || input.status === "pendente") return input.status;
  const days = daysUntil(input.validity, input.today);
  if (days === null) return null;
  if (days < 0) return "vencido";
  if (days <= 30) return "proximo_do_vencimento";
  return "valido";
}

export function canTransitionCycle(from: CycleStatus, to: CycleStatus) {
  return from === "em_andamento" && (to === "concluido" || to === "reprovado" || to === "cancelado");
}
