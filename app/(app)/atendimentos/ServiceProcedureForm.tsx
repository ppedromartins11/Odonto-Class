"use client";

import { useActionState, useState } from "react";
import { ProcedureTeethField } from "@/components/clinical/ProcedureTeethField";
import { initialProcedureActionState } from "@/lib/clinical/action-state";
import { formatCents } from "@/lib/services/validation";
import { createServiceProcedure } from "./actions";
import { ProcedureTeethRetryForm } from "./ProcedureTeethRetryForm";

type Service = { id: string; nome: string; valor_padrao_centavos: number };

export function ServiceProcedureForm({ attendanceId, services }: { attendanceId: string; services: Service[] }) {
  const [selected, setSelected] = useState(services[0]?.id ?? "");
  const current = services.find((service) => service.id === selected);
  const [state, action, pending] = useActionState(createServiceProcedure, initialProcedureActionState);

  if (state.procedureSaved && state.procedureId && !state.success) {
    return <ProcedureTeethRetryForm attendanceId={attendanceId} procedureId={state.procedureId} initialTeeth={state.attemptedTeeth ?? []} message={state.error} />;
  }

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border p-4">
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <div className="grid gap-3 md:grid-cols-[1fr_7rem_9rem]">
        <label className="text-sm font-medium">Serviço
          <select name="serviceId" value={selected} onChange={(event) => setSelected(event.target.value)} required className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm">
            <option value="">Selecionar</option>
            {services.map((service) => <option key={service.id} value={service.id}>{service.nome}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Quantidade<input name="quantidade" type="number" min="1" max="1000000" defaultValue="1" required className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" /></label>
        <label className="text-sm font-medium">Valor aplicado<input name="valorAplicado" inputMode="decimal" required defaultValue={current ? (current.valor_padrao_centavos / 100).toFixed(2) : ""} key={current?.id} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" /></label>
      </div>
      {current && <p className="text-xs text-muted-foreground">Valor padrão: {formatCents(current.valor_padrao_centavos)}. O valor aplicado fica congelado neste atendimento.</p>}
      <label className="block text-sm font-medium">Observação <span className="font-normal text-muted-foreground">(opcional)</span><textarea name="detalhes" maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>
      <ProcedureTeethField disabled={pending} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end"><button disabled={pending || !selected} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Adicionando..." : "Adicionar serviço"}</button></div>
    </form>
  );
}
