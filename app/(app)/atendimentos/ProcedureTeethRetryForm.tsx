"use client";

import { useActionState } from "react";
import { ProcedureTeethField } from "@/components/clinical/ProcedureTeethField";
import { Button } from "@/components/ui/Button";
import { initialProcedureActionState } from "@/lib/clinical/action-state";
import type { FdiTooth } from "@/lib/odontogram/fdi";
import { saveProcedureTeeth } from "./actions";
import { ProcedurePlanLinkRetryForm } from "./ProcedurePlanLinkRetryForm";

export function ProcedureTeethRetryForm({ attendanceId, procedureId, initialTeeth, message, planItemId }: {
  attendanceId: string;
  procedureId: string;
  initialTeeth: readonly FdiTooth[];
  message?: string | null;
  planItemId?: string;
}) {
  const [state, action, pending] = useActionState(saveProcedureTeeth, initialProcedureActionState);
  if (state.planLinkPending && state.procedureId && state.pendingPlanItemId) {
    return <ProcedurePlanLinkRetryForm attendanceId={attendanceId} procedureId={state.procedureId} planItemId={state.pendingPlanItemId} message={state.error} />;
  }
  return (
    <form action={action} className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <input type="hidden" name="procedureId" value={procedureId} />
      {planItemId && <input type="hidden" name="planItemId" value={planItemId} />}
      <div>
        <p role={message || state.error ? "alert" : undefined} className="text-sm font-medium text-amber-900">
          {state.success ? "Dentes vinculados com sucesso." : state.error ?? message}
        </p>
        {!state.success && <p className="mt-1 text-xs text-amber-800">O procedimento válido foi preservado. Esta tentativa altera somente os dentes.</p>}
      </div>
      {!state.success && <ProcedureTeethField initialValue={initialTeeth} disabled={pending} />}
      {!state.success && <div className="flex justify-end"><Button disabled={pending}>{pending ? "Vinculando..." : "Tentar vincular dentes"}</Button></div>}
    </form>
  );
}
