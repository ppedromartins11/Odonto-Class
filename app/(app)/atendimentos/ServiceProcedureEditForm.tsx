"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ProcedureTeethField } from "@/components/clinical/ProcedureTeethField";
import { Button } from "@/components/ui/Button";
import { initialProcedureActionState } from "@/lib/clinical/action-state";
import type { Procedure } from "@/lib/clinical/types";
import { updateServiceProcedure } from "./actions";
import { ProcedureTeethRetryForm } from "./ProcedureTeethRetryForm";

export function ServiceProcedureEditForm({ attendanceId, procedure }: { attendanceId: string; procedure: Procedure }) {
  const [state, action, pending] = useActionState(updateServiceProcedure, initialProcedureActionState);
  if (state.procedureSaved && state.procedureId && !state.success) {
    return <ProcedureTeethRetryForm attendanceId={attendanceId} procedureId={state.procedureId} initialTeeth={state.attemptedTeeth ?? procedure.teeth} message={state.error} />;
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <input type="hidden" name="procedureId" value={procedure.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Quantidade<input name="quantidade" type="number" min="1" max="1000000" defaultValue={procedure.quantidade ?? 1} required className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" /></label>
        <label className="text-sm font-medium">Valor aplicado<input name="valorAplicado" inputMode="decimal" defaultValue={((procedure.valor_aplicado_centavos ?? 0) / 100).toFixed(2)} required className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" /></label>
      </div>
      <label className="block text-sm font-medium">Detalhes <span className="font-normal text-muted-foreground">(opcional)</span><textarea name="detalhes" maxLength={2000} rows={3} defaultValue={procedure.detalhes ?? ""} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>
      <ProcedureTeethField initialValue={procedure.teeth} disabled={pending} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end gap-2"><Link href={`/atendimentos/${attendanceId}`} className="inline-flex h-10 items-center rounded-md border border-border bg-secondary px-4 text-sm font-medium">Cancelar</Link><Button disabled={pending}>{pending ? "Salvando..." : "Salvar serviço realizado"}</Button></div>
    </form>
  );
}
