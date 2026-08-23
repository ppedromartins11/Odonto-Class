"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { finalizeAttendance, saveEvolution } from "./actions";

export function EvolutionEditor({ attendanceId, initialValue }: { attendanceId: string; initialValue: string | null }) {
  const [evolution, setEvolution] = useState(initialValue ?? "");
  const [saveState, saveAction, saving] = useActionState(saveEvolution, initialDomainActionState);
  const [finishState, finishAction, finishing] = useActionState(finalizeAttendance, initialDomainActionState);
  const fieldError = saveState.fieldErrors?.evolucao ?? finishState.fieldErrors?.evolucao;
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h3 className="text-base font-medium">Evolução clínica</h3>
      <p className="mt-1 text-xs text-muted-foreground">Conteúdo clínico sensível. O histórico de auditoria registra apenas que o campo mudou.</p>
      <label htmlFor="evolucao" className="sr-only">Evolução clínica</label>
      <textarea id="evolucao" value={evolution} onChange={(event) => setEvolution(event.target.value)} rows={10} maxLength={10000} placeholder="Registre evolução, conduta e orientações clínicas essenciais." className={`mt-4 w-full resize-y rounded-md border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${fieldError ? "border-destructive" : "border-border"}`} />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{fieldError ?? "A evolução é obrigatória para finalizar."}</span><span>{evolution.length}/10.000</span></div>
      {(saveState.error || finishState.error) && <p role="alert" className="mt-3 text-sm text-destructive">{saveState.error ?? finishState.error}</p>}
      {saveState.success && <p className="mt-3 text-sm text-green-700">Evolução salva.</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <form action={saveAction}><input type="hidden" name="attendanceId" value={attendanceId} /><input type="hidden" name="evolucao" value={evolution} /><button disabled={saving || finishing} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Salvando..." : "Salvar rascunho"}</button></form>
        <form action={finishAction}><input type="hidden" name="attendanceId" value={attendanceId} /><input type="hidden" name="evolucao" value={evolution} /><button disabled={saving || finishing} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{finishing ? "Finalizando..." : "Finalizar atendimento"}</button></form>
      </div>
    </section>
  );
}
