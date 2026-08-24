"use client";

import { useActionState } from "react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import type { ReturnStatus } from "@/lib/operational/types";
import { setReturnStatus } from "./actions";

export function ReturnStatusActions({ returnId, status }: { returnId: string; status: ReturnStatus }) {
  const [state, action, pending] = useActionState(setReturnStatus, initialDomainActionState);
  if (status === "concluido" || status === "cancelado") return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="returnId" value={returnId} />
      <button name="status" value="concluido" disabled={pending} className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
        Concluir
      </button>
      <button name="status" value="cancelado" disabled={pending} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50">
        Cancelar
      </button>
      {state.error && <p role="alert" className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
