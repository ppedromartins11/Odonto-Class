"use client";

import { useActionState } from "react";
import { Stethoscope } from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { startAttendance } from "@/app/(app)/atendimentos/actions";

export function StartAttendanceButton({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(startAttendance, initialDomainActionState);
  return (
    <form action={action} className="mt-3 border-t border-border pt-3">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <button disabled={pending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        <Stethoscope className="h-3.5 w-3.5" /> {pending ? "Abrindo..." : "Iniciar atendimento"}
      </button>
      {state.error && <p role="alert" className="mt-2 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
