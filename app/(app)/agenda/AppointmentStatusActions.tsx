"use client";

import { useActionState } from "react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { changeAppointmentStatus } from "./actions";

export function AppointmentStatusActions({
  appointmentId,
  status,
}: {
  appointmentId: string;
  status: AppointmentStatus;
}) {
  const [state, action, pending] = useActionState(changeAppointmentStatus, initialDomainActionState);
  if (!["agendado", "confirmado"].includes(status)) return null;
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {status === "agendado" && (
        <button name="status" value="confirmado" disabled={pending} className="rounded-md bg-green-100 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-200 disabled:opacity-50">Confirmar</button>
      )}
      <button name="status" value="cancelado" disabled={pending} className="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50">Cancelar</button>
      <button name="status" value="faltou" disabled={pending} className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-red-100 disabled:opacity-50">Registrar falta</button>
      {state.error && <p role="alert" className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
