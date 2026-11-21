"use client";

import { useActionState, useEffect, useState } from "react";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { initialPaymentActionState, type PaymentReference } from "@/lib/financial/types";
import { isPaymentReferenceAvailable, loadPaymentReferences, type ReferenceLoadResult } from "@/lib/financial/payment-reference-loader";
import { todayInClinic } from "@/lib/agenda/dates";
import { registerPayment } from "./actions";

type PatientOption = { id: string; nome: string; telefone_contato: string | null };
type LoadStatus = ReferenceLoadResult["status"] | "idle" | "loading";

const methodLabels = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  transferencia: "Transferência",
  outro: "Outro",
};

export function PaymentForm({ patient, initialReference }: { patient?: PatientOption | null; initialReference?: string | null }) {
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(patient ?? null);
  const [references, setReferences] = useState<PaymentReference[]>([]);
  const [reference, setReference] = useState(initialReference ?? "none");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(patient ? "loading" : "idle");
  const [retry, setRetry] = useState(0);
  const [confirmNoReference, setConfirmNoReference] = useState(false);
  const [cents, setCents] = useState(0);
  const [state, action, pending] = useActionState(registerPayment, initialPaymentActionState);
  const selectedPatientId = selectedPatient?.id;

  useEffect(() => {
    if (!selectedPatientId) return;
    const controller = new AbortController();
    loadPaymentReferences(selectedPatientId, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setLoadStatus(loaded.status);
      if (loaded.status === "success" || loaded.status === "empty") setReferences(loaded.references);
    });
    return () => controller.abort();
  }, [selectedPatientId, retry]);

  const loaded = loadStatus === "success" || loadStatus === "empty";
  const referenceAvailable = isPaymentReferenceAvailable(reference, references);
  const canSubmit = !!selectedPatient && loaded && referenceAvailable && (reference !== "none" || confirmNoReference);
  const referenceMessage = loadStatus === "loading" ? "Carregando atendimentos e orçamentos..."
    : loadStatus === "empty" ? "Nenhum atendimento ou orçamento disponível para este paciente."
    : loadStatus === "network" ? "Sem conexão para carregar atendimentos e orçamentos. Verifique a rede e tente novamente."
    : loadStatus === "http" ? "Não foi possível carregar atendimentos e orçamentos. Tente novamente."
    : loadStatus === "session" ? "Sua sessão não está disponível. Entre novamente para continuar."
    : loaded && !referenceAvailable ? "A referência solicitada não está disponível para este paciente. Escolha outra referência ou confirme um pagamento sem referência."
    : null;
  const loadFailed = loadStatus === "network" || loadStatus === "http" || loadStatus === "session";
  const referenceType = reference === "none" ? "none" : reference.split(":")[0];
  const referenceId = reference === "none" ? "" : reference.split(":")[1] ?? "";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="valueCents" value={cents} />
      <input type="hidden" name="referenceType" value={selectedPatient ? referenceType : "none"} />
      <input type="hidden" name="referenceId" value={selectedPatient ? referenceId : ""} />
      <section className="rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            {patient ? (
              <>
                <input type="hidden" name="patientId" value={patient.id} />
                <div className="rounded-md bg-secondary px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Paciente: </span><span className="font-medium">{patient.nome}</span>
                </div>
              </>
            ) : <PatientPicker searchLabel="Buscar paciente para pagamento" onSelect={(nextPatient) => { setSelectedPatient(nextPatient); setReferences([]); setReference("none"); setConfirmNoReference(false); setLoadStatus(nextPatient ? "loading" : "idle"); }} />}
          </div>
          <div className="text-sm">
            <label htmlFor="payment-reference">Referência</label>
            <select id="payment-reference" value={reference} onChange={(event) => { setReference(event.target.value); setConfirmNoReference(false); }} disabled={!selectedPatient || !loaded} aria-describedby="payment-reference-feedback" aria-invalid={loaded && !referenceAvailable} className="mt-1 block h-10 w-full rounded border bg-background px-3 disabled:opacity-60">
              <option value="none">Nenhuma — somente paciente</option>
              {!referenceAvailable && reference !== "none" && <option value={reference}>Referência solicitada indisponível</option>}
              {references.map((item) => <option key={`${item.tipo}-${item.id}`} value={`${item.tipo}:${item.id}`}>{item.descricao}</option>)}
            </select>
            <p id="payment-reference-feedback" role={loadFailed || (loaded && !referenceAvailable) ? "alert" : "status"} className={`mt-1 text-xs ${loadFailed || (loaded && !referenceAvailable) ? "text-destructive" : "text-muted-foreground"}`}>
              {referenceMessage ?? "Selecione um atendimento, orçamento ou pagamento somente do paciente."}
            </p>
            {loadFailed && <button type="button" onClick={() => { setLoadStatus("loading"); setRetry((value) => value + 1); }} className="mt-2 rounded px-2 py-1 text-sm text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Tentar carregar novamente</button>}
            {reference === "none" && loaded && <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirmNoReference" value="yes" checked={confirmNoReference} onChange={(event) => setConfirmNoReference(event.target.checked)} className="mt-1" />
              <span>Confirmo que este pagamento será registrado somente para o paciente, sem vínculo com atendimento ou orçamento.</span>
            </label>}
          </div>
          <label className="text-sm">Data
            <input name="date" type="date" required defaultValue={todayInClinic()} className="mt-1 block h-10 w-full rounded border bg-background px-3" />
          </label>
          <label className="text-sm">Valor (R$)
            <input type="number" min="0.01" step="0.01" required onChange={(event) => setCents(Math.round(Number(event.target.value) * 100))} className="mt-1 block h-10 w-full rounded border bg-background px-3" />
          </label>
          <label className="text-sm">Forma de pagamento
            <select name="method" required className="mt-1 block h-10 w-full rounded border bg-background px-3">
              <option value="">Selecione</option>
              {Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm md:col-span-2">Observação administrativa
            <textarea name="observation" maxLength={1000} className="mt-1 block min-h-24 w-full rounded border bg-background p-3 text-sm" />
          </label>
        </div>
      </section>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end"><button disabled={pending || !canSubmit} className="h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Registrando..." : "Registrar pagamento"}</button></div>
    </form>
  );
}
