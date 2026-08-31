"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { initialServiceActionState } from "@/lib/services/types";
import { createService, updateService } from "./actions";

type ServiceInput = { id: string; nome: string; descricao: string | null; categoria: string | null; valor_padrao_centavos: number };
const valueForInput = (cents: number) => (cents / 100).toFixed(2);

export function ServiceForm({ service }: { service?: ServiceInput }) {
  const [state, action, pending] = useActionState(service ? updateService : createService, initialServiceActionState);
  return <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
    {service && <input type="hidden" name="serviceId" value={service.id} />}
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium">Nome<input name="nome" required minLength={2} maxLength={200} defaultValue={service?.nome ?? ""} className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm" /></label>
      <label className="text-sm font-medium">Valor padrão<input name="valorPadrao" required inputMode="decimal" defaultValue={valueForInput(service?.valor_padrao_centavos ?? 0)} className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm" /></label>
      <label className="text-sm font-medium">Categoria <span className="font-normal text-muted-foreground">(opcional)</span><input name="categoria" maxLength={100} defaultValue={service?.categoria ?? ""} className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm" /></label>
      <label className="text-sm font-medium md:col-span-2">Descrição <span className="font-normal text-muted-foreground">(opcional)</span><textarea name="descricao" rows={3} maxLength={1000} defaultValue={service?.descricao ?? ""} className="mt-1 w-full rounded-md border border-border bg-input-background px-3 py-2 text-sm" /></label>
    </div>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <div className="flex justify-end"><Button disabled={pending}>{pending ? "Salvando..." : service ? "Salvar serviço" : "Criar serviço"}</Button></div>
  </form>;
}
