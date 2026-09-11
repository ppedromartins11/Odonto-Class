"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { initialProcedureActionState } from "@/lib/clinical/action-state";
import { saveProcedurePlanLink } from "./actions";

export function ProcedurePlanLinkRetryForm({ attendanceId, procedureId, planItemId, message }: {
  attendanceId: string;
  procedureId: string;
  planItemId: string;
  message?: string | null;
}) {
  const [state, action, pending] = useActionState(saveProcedurePlanLink, initialProcedureActionState);
  return <form action={action} className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
    <input type="hidden" name="attendanceId" value={attendanceId} />
    <input type="hidden" name="procedureId" value={procedureId} />
    <input type="hidden" name="planItemId" value={planItemId} />
    <div><p role={message || state.error ? "alert" : undefined} className="text-sm font-medium text-amber-900">{state.success ? "Item do plano vinculado com sucesso." : state.error ?? message}</p>{!state.success && <p className="mt-1 text-xs text-amber-800">O procedimento válido foi preservado. Esta tentativa altera somente o vínculo com o plano.</p>}</div>
    {!state.success && <div className="flex justify-end"><Button disabled={pending}>{pending ? "Vinculando..." : "Tentar vincular ao plano"}</Button></div>}
  </form>;
}
