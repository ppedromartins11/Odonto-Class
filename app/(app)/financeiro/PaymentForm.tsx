"use client";

import { useActionState, useEffect, useState } from "react";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { initialPaymentActionState, type PaymentReference } from "@/lib/financial/types";
import { registerPayment } from "./actions";

type PatientOption = { id: string; nome: string; telefone_contato: string | null };

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
  const [reference, setReference] = useState("none");
  const [cents, setCents] = useState(0);
  const [state, action, pending] = useActionState(registerPayment, initialPaymentActionState);

  useEffect(() => {
    if (!selectedPatient) return;

    const controller = new AbortController();
    fetch(`/api/financeiro/referencias?paciente=${selectedPatient.id}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { references: [] })
      .then((payload: { references?: PaymentReference[] }) => {
        if (controller.signal.aborted) return;
        const loaded = payload.references ?? [];
        setReferences(loaded);
        const requested = initialReference && loaded.some((item) => `${item.tipo}:${item.id}` === initialReference)
          ? initialReference
          : "none";
        setReference(requested);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReferences([]);
          setReference("none");
        }
      });

    return () => controller.abort();
  }, [initialReference, selectedPatient]);

  const referenceType = reference === "none" ? "none" : reference.split(":")[0];
  const referenceId = reference === "none" ? "" : reference.split(":")[1];

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="valueCents" value={cents} />
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
            ) : <PatientPicker searchLabel="Buscar paciente para pagamento" onSelect={(nextPatient) => { setSelectedPatient(nextPatient); setReferences([]); setReference("none"); }} />}
          </div>
          <label className="text-sm">Referência
            <select value={reference} onChange={(event) => setReference(event.target.value)} disabled={!selectedPatient} className="mt-1 block h-10 w-full rounded border bg-background px-3 disabled:opacity-60">
              <option value="none">Nenhuma — somente paciente</option>
              {(selectedPatient ? references : []).map((item) => <option key={`${item.tipo}-${item.id}`} value={`${item.tipo}:${item.id}`}>{item.descricao}</option>)}
            </select>
            <input type="hidden" name="referenceType" value={selectedPatient ? referenceType : "none"} />
            <input type="hidden" name="referenceId" value={selectedPatient ? referenceId : ""} />
          </label>
          <label className="text-sm">Data
            <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 block h-10 w-full rounded border bg-background px-3" />
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
      <div className="flex justify-end"><button disabled={pending} className="h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">{pending ? "Registrando..." : "Registrar pagamento"}</button></div>
    </form>
  );
}
