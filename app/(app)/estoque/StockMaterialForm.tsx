"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialStockActionState } from "@/lib/stock/types";
import { unitLabels } from "@/lib/stock/validation";
import { STOCK_UNITS } from "@/lib/stock/types";
import { createStockMaterial, updateStockMaterial } from "./actions";

type Material = { id: string; nome: string; categoria: string; unidade: (typeof STOCK_UNITS)[number]; estoque_minimo: number; quantidade_atual: number; validade: string | null; fornecedor: string | null; ativo: boolean };
function FieldError({ children }: { children?: string }) { return children ? <p className="mt-1 text-xs text-destructive">{children}</p> : null; }

export function StockMaterialForm({ material }: { material?: Material }) {
  const [state, action, pending] = useActionState(material ? updateStockMaterial : createStockMaterial, initialStockActionState);
  return <form action={action} className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm">
    {material && <input type="hidden" name="materialId" value={material.id} />}
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium">Nome<Input name="nome" required minLength={2} maxLength={200} defaultValue={material?.nome ?? ""} error={Boolean(state.fieldErrors?.nome)} /></label>
      <label className="text-sm font-medium">Categoria<Input name="categoria" required minLength={2} maxLength={100} placeholder="Ex.: Descartáveis" defaultValue={material?.categoria ?? ""} error={Boolean(state.fieldErrors?.categoria)} /></label>
      <label className="text-sm font-medium">Unidade<select name="unidade" defaultValue={material?.unidade ?? "unidade"} className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm">{STOCK_UNITS.map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}</select></label>
      <label className="text-sm font-medium">Estoque mínimo<Input name="estoqueMinimo" type="number" min="0" max="1000000" required defaultValue={material?.estoque_minimo ?? 0} error={Boolean(state.fieldErrors?.estoqueMinimo)} /></label>
      {!material && <label className="text-sm font-medium">Quantidade inicial<Input name="quantidadeInicial" type="number" min="0" max="1000000" required defaultValue="0" error={Boolean(state.fieldErrors?.quantidadeInicial)} /><span className="mt-1 block text-xs font-normal text-muted-foreground">Uma quantidade maior que zero gera uma entrada inicial.</span></label>}
      {material && <div className="text-sm font-medium">Quantidade atual<p className="mt-1 flex h-10 items-center rounded-md border border-border bg-secondary px-3 font-normal">{material.quantidade_atual} · altere somente por movimentação</p></div>}
      <label className="text-sm font-medium">Validade <span className="font-normal text-muted-foreground">(opcional)</span><Input name="validade" type="date" defaultValue={material?.validade ?? ""} error={Boolean(state.fieldErrors?.validade)} /></label>
      <label className="text-sm font-medium">Fornecedor <span className="font-normal text-muted-foreground">(opcional)</span><Input name="fornecedor" maxLength={200} defaultValue={material?.fornecedor ?? ""} error={Boolean(state.fieldErrors?.fornecedor)} /></label>
      {!material && <label className="flex items-center gap-2 text-sm font-medium"><input name="ativo" type="checkbox" value="true" defaultChecked /> Material ativo</label>}
    </div>
    <FieldError>{state.fieldErrors?.nome || state.fieldErrors?.categoria || state.fieldErrors?.unidade || state.fieldErrors?.estoqueMinimo || state.fieldErrors?.quantidadeInicial || state.fieldErrors?.validade || state.fieldErrors?.fornecedor}</FieldError>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <div className="flex justify-end"><Button disabled={pending}>{pending ? "Salvando..." : material ? "Salvar alterações" : "Criar material"}</Button></div>
  </form>;
}
