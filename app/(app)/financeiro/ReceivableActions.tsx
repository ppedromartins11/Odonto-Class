"use client";

import { useActionState } from "react";
import { initialReceivableActionState, type PaymentMethod } from "@/lib/financial/types";
import { cancelFinancialReceivable, registerInstallmentPayment } from "./actions";

const methods: Record<PaymentMethod, string> = { pix: "PIX", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito", transferencia: "Transferência", outro: "Outro" };

export function InstallmentPaymentForm({ installmentId, receivableId, patientId }: { installmentId: string; receivableId: string; patientId: string }) {
  const [state, action, pending] = useActionState(registerInstallmentPayment, initialReceivableActionState);
  return <form action={action} className="flex flex-wrap items-center justify-end gap-2"><input type="hidden" name="installmentId" value={installmentId}/><input type="hidden" name="receivableId" value={receivableId}/><input type="hidden" name="patientId" value={patientId}/><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className="h-8 rounded border bg-background px-2 text-xs"/><select name="method" defaultValue="pix" className="h-8 rounded border bg-background px-2 text-xs">{Object.entries(methods).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button disabled={pending} className="h-8 rounded bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{pending ? "..." : "Registrar"}</button>{state.error && <span role="alert" className="basis-full text-right text-xs text-destructive">{state.error}</span>}</form>;
}

export function ReceivableCancelForm({ receivableId, patientId }: { receivableId: string; patientId: string }) {
  const [state, action, pending] = useActionState(cancelFinancialReceivable, initialReceivableActionState);
  return <form action={action}><input type="hidden" name="receivableId" value={receivableId}/><input type="hidden" name="patientId" value={patientId}/><button disabled={pending} onClick={(event) => { if (!window.confirm("Cancelar este recebível sem pagamento confirmado?")) event.preventDefault(); }} className="h-9 rounded border border-destructive/30 px-3 text-sm text-destructive disabled:opacity-50">{pending ? "Cancelando..." : "Cancelar recebível"}</button>{state.error && <p role="alert" className="mt-1 text-xs text-destructive">{state.error}</p>}</form>;
}
