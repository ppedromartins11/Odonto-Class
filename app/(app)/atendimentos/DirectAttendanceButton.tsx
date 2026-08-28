"use client";

import { useActionState } from "react";
import { Stethoscope } from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { createDirectAttendance } from "./actions";

export function DirectAttendanceButton({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(createDirectAttendance, initialDomainActionState);
  return (
    <form action={action}>
      <input type="hidden" name="patientId" value={patientId} />
      <button disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/70 px-3 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"><Stethoscope className="h-3.5 w-3.5" />{pending ? "Abrindo..." : "Atendimento"}</button>
      {state.error && <p role="alert" className="mt-2 max-w-xs text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
