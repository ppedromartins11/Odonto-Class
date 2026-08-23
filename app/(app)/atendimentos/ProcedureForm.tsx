"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import type { Procedure } from "@/lib/clinical/types";
import { createProcedure, updateProcedure } from "./actions";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null;
}

export function ProcedureForm({ attendanceId, procedure }: { attendanceId: string; procedure?: Procedure }) {
  const [state, action, pending] = useActionState(procedure ? updateProcedure : createProcedure, initialDomainActionState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="attendanceId" value={attendanceId} />
      {procedure && <input type="hidden" name="procedureId" value={procedure.id} />}
      <div><label htmlFor="descricao" className="mb-1.5 block">Descrição do procedimento</label><Input id="descricao" name="descricao" required minLength={2} maxLength={500} defaultValue={procedure?.descricao ?? ""} error={Boolean(state.fieldErrors?.descricao)} /><FieldError message={state.fieldErrors?.descricao} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="dente" className="mb-1.5 block">Dente ou região</label><Input id="dente" name="dente" maxLength={80} defaultValue={procedure?.dente ?? ""} placeholder="Ex.: 11 (FDI) ou região anterior" error={Boolean(state.fieldErrors?.dente)} /><FieldError message={state.fieldErrors?.dente} /></div>
        <div><label htmlFor="corResina" className="mb-1.5 block">Cor da resina</label><Input id="corResina" name="corResina" maxLength={80} defaultValue={procedure?.cor_resina ?? ""} placeholder="Quando aplicável" error={Boolean(state.fieldErrors?.corResina)} /><FieldError message={state.fieldErrors?.corResina} /></div>
      </div>
      <div><label htmlFor="materialUtilizado" className="mb-1.5 block">Material utilizado</label><Input id="materialUtilizado" name="materialUtilizado" maxLength={500} defaultValue={procedure?.material_utilizado ?? ""} placeholder="Opcional; não movimenta estoque" error={Boolean(state.fieldErrors?.materialUtilizado)} /><FieldError message={state.fieldErrors?.materialUtilizado} /></div>
      <div><label htmlFor="detalhes" className="mb-1.5 block">Detalhes clínicos mínimos</label><textarea id="detalhes" name="detalhes" maxLength={2000} rows={3} defaultValue={procedure?.detalhes ?? ""} className={`w-full resize-y rounded-md border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${state.fieldErrors?.detalhes ? "border-destructive" : "border-border"}`} /><FieldError message={state.fieldErrors?.detalhes} /></div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.success && !procedure && <p className="text-sm text-green-700">Procedimento adicionado.</p>}
      <div className="flex justify-end gap-2">{procedure && <Link href={`/atendimentos/${attendanceId}`} className="inline-flex h-10 items-center rounded-md border border-border bg-secondary px-4 text-sm font-medium">Cancelar</Link>}<Button disabled={pending}>{pending ? "Salvando..." : procedure ? "Salvar procedimento" : "Adicionar procedimento"}</Button></div>
    </form>
  );
}
