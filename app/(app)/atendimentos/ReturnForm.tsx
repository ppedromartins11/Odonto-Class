"use client";
import { useActionState } from "react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { createReturn } from "@/app/(app)/retornos/actions";
export function ReturnForm({attendanceId}:{attendanceId:string}){const [state,action,pending]=useActionState(createReturn,initialDomainActionState);return <form action={action} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="attendanceId" value={attendanceId}/><input required name="dueDate" type="date" className="h-9 rounded border px-2 text-sm"/><input name="note" maxLength={1000} placeholder="Observação administrativa" className="h-9 flex-1 rounded border px-2 text-sm"/><button disabled={pending} className="h-9 rounded bg-primary px-3 text-sm text-primary-foreground">{pending?"Salvando...":"Criar retorno"}</button>{state.error&&<p role="alert" className="w-full text-xs text-destructive">{state.error}</p>}</form>}
