"use client";

import { useActionState } from "react";
import { Download, FilePlus2 } from "lucide-react";
import { initialBudgetActionState, type BudgetPdfVersion } from "@/lib/budgets/types";
import { issueBudgetPdf } from "./actions";

export function BudgetPdfVersions({ budgetId, versions }: { budgetId: string; versions: BudgetPdfVersion[] }) {
  const [state, action, pending] = useActionState(issueBudgetPdf, initialBudgetActionState);
  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-medium">PDFs emitidos</h3><p className="mt-1 text-sm text-muted-foreground">Cada versão é privada, imutável e preserva exatamente os dados existentes na emissão.</p></div>
        <form action={action}>
          <input type="hidden" name="budgetId" value={budgetId} />
          <button disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"><FilePlus2 className="h-4 w-4" />{pending ? "Emitindo..." : versions.length ? "Emitir nova versão" : "Emitir PDF"}</button>
        </form>
      </div>
      {state.error && <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p>}
      {state.success && <p role="status" className="mt-3 text-sm text-emerald-700">Nova versão emitida com sucesso.</p>}
      {versions.length === 0 ? <p className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma versão foi emitida. O orçamento em tela ainda pode mudar.</p> : (
        <div className="mt-4 divide-y rounded-md border">
          {versions.map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm"><div><p className="font-medium">Versão {version.versao}</p><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.emitido_em))} · layout v{version.layout_version}</p></div><a href={`/api/orcamentos/${budgetId}/pdf/${version.id}`} className="inline-flex h-8 items-center gap-1 rounded border px-2 text-xs font-medium hover:bg-secondary"><Download className="h-3.5 w-3.5" />Baixar esta versão</a></div>)}
        </div>
      )}
    </section>
  );
}

