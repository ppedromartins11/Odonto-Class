"use client";

import { useActionState, useEffect, useState } from "react";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { initialReceivableActionState, type PaymentReference } from "@/lib/financial/types";
import { createFinancialReceivable } from "./actions";

type PatientOption = { id: string; nome: string; telefone_contato: string | null };

export function ReceivableForm() {
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [references, setReferences] = useState<PaymentReference[]>([]);
  const [reference, setReference] = useState("none");
  const [totalCents, setTotalCents] = useState(0);
  const [installments, setInstallments] = useState(1);
  const [state, action, pending] = useActionState(createFinancialReceivable, initialReceivableActionState);

  useEffect(() => {
    if (!patient) return;
    const controller = new AbortController();
    fetch(`/api/financeiro/referencias?paciente=${patient.id}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : { references: [] })
      .then((payload: { references?: PaymentReference[] }) => { if (!controller.signal.aborted) setReferences(payload.references ?? []); })
      .catch(() => { if (!controller.signal.aborted) setReferences([]); });
    return () => controller.abort();
  }, [patient]);

  const referenceType = reference === "none" ? "none" : reference.split(":")[0];
  const referenceId = reference === "none" ? "" : reference.split(":")[1];
  const firstDueDate = new Date().toISOString().slice(0, 10);
  const handlePatient = (nextPatient: PatientOption | null) => {
    setPatient(nextPatient);
    setReferences([]);
    setReference("none");
  };

  return <form action={action} className="space-y-5">
    <input type="hidden" name="totalCents" value={totalCents} />
    <input type="hidden" name="referenceType" value={referenceType} />
    <input type="hidden" name="referenceId" value={referenceId} />
    <section className="rounded-lg border bg-card p-5"><div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><PatientPicker inputName="patientId" searchLabel="Buscar paciente para recebível" onSelect={handlePatient} /></div>
      <label className="text-sm">Origem opcional<select value={reference} onChange={(event) => setReference(event.target.value)} disabled={!patient} className="mt-1 block h-10 w-full rounded border bg-background px-3 disabled:opacity-60"><option value="none">Paciente — sem origem vinculada</option>{references.map((item) => <option key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.descricao}</option>)}</select></label>
      <label className="text-sm">Valor total (R$)<input type="number" min="0.01" step="0.01" required onChange={(event) => setTotalCents(Math.round(Number(event.target.value) * 100))} className="mt-1 block h-10 w-full rounded border bg-background px-3" /></label>
      <label className="text-sm">Número de parcelas<input name="installments" type="number" min="1" max="120" value={installments} onChange={(event) => setInstallments(Math.max(1, Number(event.target.value) || 1))} className="mt-1 block h-10 w-full rounded border bg-background px-3" /></label>
      <label className="text-sm">Primeiro vencimento<input name="firstDueDate" type="date" required defaultValue={firstDueDate} className="mt-1 block h-10 w-full rounded border bg-background px-3" /></label>
      <label className="text-sm">Intervalo entre parcelas<select name="intervalMonths" className="mt-1 block h-10 w-full rounded border bg-background px-3"><option value="1">Mensal</option><option value="2">A cada 2 meses</option><option value="3">Trimestral</option></select></label>
      <p className="self-end text-xs text-muted-foreground">{installments === 1 ? "À vista: será criada uma única parcela." : `${installments} parcelas, com centavos distribuídos automaticamente.`}</p>
      <label className="text-sm md:col-span-2">Observação administrativa opcional<textarea name="observation" maxLength={1000} className="mt-1 block min-h-24 w-full rounded border bg-background p-3 text-sm" /></label>
    </div></section>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <div className="flex justify-end"><button disabled={pending} className="h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Criando..." : "Criar recebível"}</button></div>
  </form>;
}
