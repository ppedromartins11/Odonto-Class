"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialStockActionState, type StockMovementType } from "@/lib/stock/types";
import { movementLabels } from "@/lib/stock/validation";
import { registerStockMovement } from "./actions";

export function StockMovementForm({ materialId, type, profile }: { materialId: string; type: StockMovementType; profile: "administrador" | "recepcao" | "dentista" }) {
  const [state, action, pending] = useActionState(registerStockMovement, initialStockActionState);
  const requiresReason = type === "ajuste" || (type === "saida" && profile === "dentista");
  const label = type === "ajuste" ? "Nova contagem física" : "Quantidade";
  return <form action={action} className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4">
    <input type="hidden" name="materialId" value={materialId} /><input type="hidden" name="tipo" value={type} />
    <h3 className="font-medium">{movementLabels[type]}</h3>
    <label className="block text-sm font-medium">{label}<Input name="quantidade" type="number" min={type === "ajuste" ? "0" : "1"} max="1000000" required /><span className="mt-1 block text-xs font-normal text-muted-foreground">{type === "ajuste" ? "Substitui o saldo atual; exige motivo." : "O saldo será atualizado imediatamente."}</span></label>
    <label className="block text-sm font-medium">Motivo {requiresReason ? "*" : "(opcional)"}<textarea name="motivo" required={requiresReason} minLength={requiresReason ? 2 : undefined} maxLength={500} rows={2} className="mt-1 w-full rounded-md border border-border bg-input-background p-2 text-sm" /></label>
    <label className="block text-sm font-medium">Referência <span className="font-normal text-muted-foreground">(opcional)</span><Input name="referencia" maxLength={120} placeholder="Ex.: nota ou conferência" /></label>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.success && <p className="text-sm text-emerald-700">Movimentação registrada.</p>}
    <Button size="sm" disabled={pending}>{pending ? "Registrando..." : `Registrar ${movementLabels[type].toLowerCase()}`}</Button>
  </form>;
}
