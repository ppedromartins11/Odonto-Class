"use client";

import { useActionState, useEffect, useState } from "react";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { initialReceivableActionState, type PaymentReference } from "@/lib/financial/types";
import { isPaymentReferenceAvailable, loadPaymentReferences, type ReferenceLoadResult } from "@/lib/financial/payment-reference-loader";
import { todayInClinic } from "@/lib/agenda/dates";
import { createFinancialReceivable } from "./actions";

type PatientOption = { id: string; nome: string; telefone_contato: string | null };
type LoadStatus = ReferenceLoadResult["status"] | "idle" | "loading";

export function ReceivableForm() {
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [references, setReferences] = useState<PaymentReference[]>([]);
  const [reference, setReference] = useState("none");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [retry, setRetry] = useState(0);
  const [confirmNoReference, setConfirmNoReference] = useState(false);
  const [totalCents, setTotalCents] = useState(0);
  const [installments, setInstallments] = useState(1);
  const [state, action, pending] = useActionState(createFinancialReceivable, initialReceivableActionState);

  const patientId = patient?.id;
  useEffect(() => {
    if (!patientId) return;
    const controller = new AbortController();
    loadPaymentReferences(patientId, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setLoadStatus(loaded.status);
      if (loaded.status === "success" || loaded.status === "empty") setReferences(loaded.references);
    });
    return () => controller.abort();
  }, [patientId, retry]);

  const loaded = loadStatus === "success" || loadStatus === "empty";
  const referenceAvailable = isPaymentReferenceAvailable(reference, references);
  const canSubmit = !!patient && loaded && referenceAvailable && (reference !== "none" || confirmNoReference);
  const loadFailed = loadStatus === "network" || loadStatus === "http" || loadStatus === "session";
  const referenceMessage = loadStatus === "loading" ? "Carregando atendimentos e orçamentos..."
    : loadStatus === "empty" ? "Nenhum atendimento ou orçamento disponível para este paciente."
    : loadStatus === "network" ? "Sem conexão para carregar atendimentos e orçamentos. Verifique a rede e tente novamente."
    : loadStatus === "http" ? "Não foi possível carregar atendimentos e orçamentos. Tente novamente."
    : loadStatus === "session" ? "Sua sessão não está disponível. Entre novamente para continuar."
    : loaded && !referenceAvailable ? "A origem selecionada não está mais disponível para este paciente. Escolha outra origem ou confirme um recebível sem origem."
    : null;
  const referenceType = reference === "none" ? "none" : reference.split(":")[0];
  const referenceId = reference === "none" ? "" : reference.split(":")[1] ?? "";
  const firstDueDate = todayInClinic();
  const handlePatient = (nextPatient: PatientOption | null) => {
    setPatient(nextPatient);
    setReferences([]);
    setReference("none");
    setConfirmNoReference(false);
    setLoadStatus(nextPatient ? "loading" : "idle");
  };

  return <form action={action} className="space-y-5">
    <input type="hidden" name="totalCents" value={totalCents} />
    <input type="hidden" name="referenceType" value={referenceType} />
    <input type="hidden" name="referenceId" value={referenceId} />
    <section className="rounded-lg border bg-card p-5"><div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><PatientPicker inputName="patientId" searchLabel="Buscar paciente para recebível" onSelect={handlePatient} /></div>
      <div className="text-sm">
        <label htmlFor="receivable-reference">Origem opcional</label>
        <select id="receivable-reference" value={reference} onChange={(event) => { setReference(event.target.value); setConfirmNoReference(false); }} disabled={!patient || !loaded} aria-describedby="receivable-reference-feedback" aria-invalid={loaded && !referenceAvailable} className="mt-1 block h-10 w-full rounded border bg-background px-3 disabled:opacity-60">
          <option value="none">Paciente — sem origem vinculada</option>
          {!referenceAvailable && reference !== "none" && <option value={reference}>Origem selecionada indisponível</option>}
          {references.map((item) => <option key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.descricao}</option>)}
        </select>
        <p id="receivable-reference-feedback" role={loadFailed || (loaded && !referenceAvailable) ? "alert" : "status"} className={`mt-1 text-xs ${loadFailed || (loaded && !referenceAvailable) ? "text-destructive" : "text-muted-foreground"}`}>
          {referenceMessage ?? "Selecione uma origem ou confirme o recebível somente para o paciente."}
        </p>
        {loadFailed && <button type="button" onClick={() => { setLoadStatus("loading"); setRetry((value) => value + 1); }} className="mt-2 rounded px-2 py-1 text-sm text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Tentar carregar novamente</button>}
        {reference === "none" && loaded && <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmNoReference" value="yes" checked={confirmNoReference} onChange={(event) => setConfirmNoReference(event.target.checked)} className="mt-1" />
          <span>Confirmo que este recebível será criado somente para o paciente, sem vínculo com atendimento ou orçamento.</span>
        </label>}
      </div>
      <label className="text-sm">Valor total (R$)<input type="number" min="0.01" step="0.01" required onChange={(event) => setTotalCents(Math.round(Number(event.target.value) * 100))} className="mt-1 block h-10 w-full rounded border bg-background px-3" /></label>
      <label className="text-sm">Número de parcelas<input name="installments" type="number" min="1" max="120" value={installments} onChange={(event) => setInstallments(Math.max(1, Number(event.target.value) || 1))} className="mt-1 block h-10 w-full rounded border bg-background px-3" /></label>
      <label className="text-sm">Primeiro vencimento<input name="firstDueDate" type="date" required defaultValue={firstDueDate} className="mt-1 block h-10 w-full rounded border bg-background px-3" /></label>
      <label className="text-sm">Intervalo entre parcelas<select name="intervalMonths" className="mt-1 block h-10 w-full rounded border bg-background px-3"><option value="1">Mensal</option><option value="2">A cada 2 meses</option><option value="3">Trimestral</option></select></label>
      <p className="self-end text-xs text-muted-foreground">{installments === 1 ? "À vista: será criada uma única parcela." : `${installments} parcelas, com centavos distribuídos automaticamente.`}</p>
      <label className="text-sm md:col-span-2">Observação administrativa opcional<textarea name="observation" maxLength={1000} className="mt-1 block min-h-24 w-full rounded border bg-background p-3 text-sm" /></label>
    </div></section>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <div className="flex justify-end"><button disabled={pending || !canSubmit} className="h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Criando..." : "Criar recebível"}</button></div>
  </form>;
}
