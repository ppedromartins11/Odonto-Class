import type { AppointmentStatus } from "./types";

export const APPOINTMENT_STATUS_VISUAL: Record<
  AppointmentStatus,
  {
    label: string;
    tone: "info" | "success" | "neutral" | "danger" | "warning";
  }
> = {
  agendado: { label: "Agendado", tone: "info" },
  confirmado: { label: "Confirmado", tone: "success" },
  atendido: { label: "Atendido", tone: "neutral" },
  cancelado: { label: "Cancelado", tone: "danger" },
  faltou: { label: "Faltou", tone: "warning" },
};

export const APPOINTMENT_BLOCK_STYLE: Record<AppointmentStatus, string> = {
  agendado: "border-blue-200 bg-blue-50/90",
  confirmado: "border-emerald-200 bg-emerald-50/90",
  atendido: "border-slate-200 bg-slate-100/90",
  cancelado: "border-red-200 bg-red-50/80 opacity-75",
  faltou: "border-amber-200 bg-amber-50/90",
};

const SCHEDULE_BLOCKING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "agendado",
  "confirmado",
  "atendido",
]);

/**
 * Mantem o layout visual alinhado a constraint de conflito da migration 0004.
 * Cancelamentos e faltas permanecem no historico, mas liberam o horario.
 */
export function appointmentBlocksSchedule(status: AppointmentStatus) {
  return SCHEDULE_BLOCKING_STATUSES.has(status);
}

export function splitAppointmentsByOccupancy<T extends { status: AppointmentStatus }>(items: T[]) {
  return {
    occupying: items.filter((item) => appointmentBlocksSchedule(item.status)),
    historical: items.filter((item) => !appointmentBlocksSchedule(item.status)),
  };
}
