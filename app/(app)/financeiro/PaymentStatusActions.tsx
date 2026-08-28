"use client";

import { useActionState } from "react";
import { initialPaymentActionState, type PaymentStatus } from "@/lib/financial/types";
import { changePaymentStatus } from "./actions";

export function PaymentStatusActions({ paymentId, patientId, status }: { paymentId: string; patientId: string; status: PaymentStatus }) {
  const [state, action, pending] = useActionState(changePaymentStatus, initialPaymentActionState);
  if (status !== "pago") return null;

  function confirm(message: string) {
    return () => window.confirm(message);
  }

  return (
    <form action={action} className="flex gap-1">
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="patientId" value={patientId} />
      {state.error && <span role="alert" className="text-xs text-destructive">{state.error}</span>}
      <button disabled={pending} name="status" value="cancelado" onClick={confirm("Cancelar este pagamento? O valor permanecerá somente para histórico.")} className="text-xs text-destructive hover:underline">Cancelar</button>
      <button disabled={pending} name="status" value="estornado" onClick={confirm("Estornar este pagamento? O valor permanecerá somente para histórico.")} className="text-xs text-destructive hover:underline">Estornar</button>
    </form>
  );
}
