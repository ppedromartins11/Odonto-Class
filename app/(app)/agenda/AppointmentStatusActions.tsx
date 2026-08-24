"use client";

import { useActionState } from "react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { changeAppointmentStatus } from "./actions";

export function AppointmentStatusActions({
  appointmentId,
  status,
  compact = false,
}: {
  appointmentId: string;
  status: AppointmentStatus;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(changeAppointmentStatus, initialDomainActionState);
  if (!["agendado", "confirmado"].includes(status)) return null;
  return (
    <form action={action} className={compact ? "inline-flex items-center" : "mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"}>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {compact ? (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary">Ações</summary>
          <div className="absolute right-0 z-10 mt-1 flex w-36 flex-col gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg">
            {status === "agendado" && <button name="status" value="confirmado" disabled={pending} className="rounded px-2 py-1.5 text-left text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50">Confirmar</button>}
            <button name="status" value="cancelado" disabled={pending} className="rounded px-2 py-1.5 text-left text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50">Cancelar</button>
            <button name="status" value="faltou" disabled={pending} className="rounded px-2 py-1.5 text-left text-xs font-medium text-destructive hover:bg-red-50 disabled:opacity-50">Registrar falta</button>
          </div>
        </details>
      ) : <>
        {status === "agendado" && <button name="status" value="confirmado" disabled={pending} className="rounded-md bg-green-100 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-200 disabled:opacity-50">Confirmar</button>}
        <button name="status" value="cancelado" disabled={pending} className="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50">Cancelar</button>
        <button name="status" value="faltou" disabled={pending} className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-red-100 disabled:opacity-50">Registrar falta</button>
      </>}
      {state.error && <p role="alert" className={compact ? "absolute z-20 mt-1 w-52 rounded bg-card p-2 text-xs text-destructive shadow" : "w-full text-xs text-destructive"}>{state.error}</p>}
    </form>
  );
}
