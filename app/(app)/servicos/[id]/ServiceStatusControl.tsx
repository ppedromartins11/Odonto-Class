"use client";
import { useActionState } from "react";
import { initialServiceActionState } from "@/lib/services/types";
import { setServiceActive } from "../actions";

export function ServiceStatusControl({ serviceId, active }: { serviceId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setServiceActive, initialServiceActionState);
  return <form action={action} className="flex items-center gap-2"><input type="hidden" name="serviceId" value={serviceId} /><input type="hidden" name="ativo" value={active ? "false" : "true"} /><button disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm">{pending ? "Salvando..." : active ? "Inativar serviço" : "Ativar serviço"}</button>{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}</form>;
}
