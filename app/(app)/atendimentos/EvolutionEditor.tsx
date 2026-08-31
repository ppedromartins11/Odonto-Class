"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { finalizeAttendance, previewAttendanceFinalization, saveEvolution } from "./actions";

type PreviewItem = {
  material_id: string;
  material_nome: string;
  necessario: number;
  disponivel: number;
  saldo_apos: number;
  suficiente: boolean;
};

export function EvolutionEditor({ attendanceId, initialValue }: { attendanceId: string; initialValue: string | null }) {
  const [evolution, setEvolution] = useState(initialValue ?? "");
  const [saveState, saveAction, saving] = useActionState(saveEvolution, initialDomainActionState);
  const [finishState, finishAction, finishing] = useActionState(finalizeAttendance, initialDomainActionState);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [finalizationSubmitted, setFinalizationSubmitted] = useState(false);
  const finalizationTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelPreviewRef = useRef<HTMLButtonElement>(null);
  const fieldError = saveState.fieldErrors?.evolucao ?? finishState.fieldErrors?.evolucao;

  const closePreview = () => {
    setPreview(null);
    setPreviewError(null);
    setFinalizationSubmitted(false);
    requestAnimationFrame(() => finalizationTriggerRef.current?.focus());
  };

  useEffect(() => {
    if (!preview) return;
    const focusTimer = window.setTimeout(() => cancelPreviewRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !finishing && !finalizationSubmitted) {
        event.preventDefault();
        closePreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [preview, finishing, finalizationSubmitted]);

  useEffect(() => {
    if (!finishState.success && !finishState.error) return;
    const stateTimer = window.setTimeout(() => {
      if (finishState.success) closePreview();
      if (finishState.error) setFinalizationSubmitted(false);
    }, 0);
    return () => window.clearTimeout(stateTimer);
  }, [finishState.success, finishState.error]);

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
        <button ref={finalizationTriggerRef} type="button" disabled={saving || finishing} onClick={async () => { const response = await previewAttendanceFinalization(attendanceId); setPreviewError(response.error); if (!response.error) setPreview(response.items); }} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Finalizar atendimento</button>
      </div>
      {previewError && <p role="alert" className="mt-3 text-sm text-destructive">{previewError}</p>}
      {preview && <div role="dialog" aria-modal="true" aria-labelledby="finalization-dialog-title" onMouseDown={closePreview} className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center"><div onMouseDown={(event) => event.stopPropagation()} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-5 shadow-xl"><h4 id="finalization-dialog-title" className="text-lg font-medium">Finalizar atendimento?</h4><p className="mt-1 text-sm text-muted-foreground">Revise os materiais que serão consumidos. O atendimento só será finalizado se todos tiverem saldo.</p><div className="mt-4 space-y-2">{preview.length === 0 ? <p className="rounded-md bg-secondary p-3 text-sm">Nenhum material configurado para os serviços realizados.</p> : preview.map((item) => <div key={item.material_id} className={`rounded-md border p-3 text-sm ${item.suficiente ? "border-border" : "border-destructive"}`}><p className="font-medium">{item.material_nome}</p><p className="mt-1 text-muted-foreground">Consumir {item.necessario} · disponível {item.disponivel} · saldo após {item.saldo_apos}</p>{!item.suficiente && <p className="mt-1 text-destructive">Estoque insuficiente ou material inativo.</p>}</div>)}</div><div className="mt-5 flex justify-end gap-2"><button ref={cancelPreviewRef} type="button" disabled={finishing || finalizationSubmitted} onClick={closePreview} className="h-9 rounded-md border border-border px-3 text-sm">Voltar</button><form action={finishAction} onSubmit={() => setFinalizationSubmitted(true)}><input type="hidden" name="attendanceId" value={attendanceId} /><input type="hidden" name="evolucao" value={evolution} /><button disabled={saving || finishing || finalizationSubmitted || preview.some((item) => !item.suficiente)} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{finishing || finalizationSubmitted ? "Finalizando..." : "Finalizar atendimento"}</button></form></div></div></div>}
    </section>
  );
}
