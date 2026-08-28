"use client";

import { useActionState } from "react";
import { createReturn } from "@/app/(app)/retornos/actions";
import { initialDomainActionState } from "@/lib/agenda/action-state";

export function ReturnForm({ attendanceId }: { attendanceId: string }) {
  const [state, action, pending] = useActionState(
    createReturn,
    initialDomainActionState,
  );

  return (
    <form action={action} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
        Data prevista
        <input
          required
          name="dueDate"
          type="date"
          className="h-9 rounded border px-2 text-sm font-normal"
        />
      </label>
      <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-foreground">
        Observação administrativa
        <input
          name="note"
          maxLength={1000}
          placeholder="Opcional"
          className="h-9 rounded border px-2 text-sm font-normal"
        />
      </label>
      <button
        disabled={pending}
        className="mt-auto h-9 rounded bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Salvando..." : "Criar retorno"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
