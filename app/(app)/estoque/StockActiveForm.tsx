"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { initialStockActionState } from "@/lib/stock/types";
import { setStockMaterialActive } from "./actions";

export function StockActiveForm({ materialId, active }: { materialId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setStockMaterialActive, initialStockActionState);
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Tem certeza que deseja ${active ? "inativar" : "ativar"} este material?`)) event.preventDefault(); }}>
    <input type="hidden" name="materialId" value={materialId} /><input type="hidden" name="ativo" value={String(!active)} />
    {state.error && <p role="alert" className="mb-2 text-sm text-destructive">{state.error}</p>}
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Salvando..." : active ? "Inativar material" : "Ativar material"}</Button>
  </form>;
}
