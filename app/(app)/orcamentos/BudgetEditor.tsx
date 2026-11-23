"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { formatCents, parseReaisToCents } from "@/lib/budgets/validation";
import { initialBudgetActionState, type BudgetDetail } from "@/lib/budgets/types";
import { saveBudget } from "./actions";

type DraftItem = {
  id?: string;
  descricao: string;
  quantidade: number;
  valorUnitarioReais: string;
  removed?: boolean;
};

const newItem = (): DraftItem => ({ descricao: "", quantidade: 1, valorUnitarioReais: "0,00" });
const reaisFromCents = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function BudgetEditor({
  budget,
  patient,
  professionals,
}: {
  budget?: BudgetDetail;
  patient?: { id: string; nome: string; telefone_contato: string | null } | null;
  professionals: { id: string; nome: string }[];
}) {
  const [items, setItems] = useState<DraftItem[]>(
    budget?.items.map((item) => ({
      id: item.id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      valorUnitarioReais: reaisFromCents(item.valor_unitario_centavos),
    })) ?? [newItem()]
  );
  const [state, action, pending] = useActionState(saveBudget, initialBudgetActionState);
  const editable = !budget || budget.effective_status === "rascunho";

  const serializedItems = useMemo(() => items.map((item) => ({
    id: item.id,
    descricao: item.descricao,
    quantidade: item.quantidade,
    valorUnitarioCentavos: parseReaisToCents(item.valorUnitarioReais),
    removed: item.removed === true,
  })), [items]);
  const total = useMemo(() => serializedItems
    .filter((item) => !item.removed)
    .reduce((sum, item) => sum + Math.max(0, item.quantidade || 0) * (item.valorUnitarioCentavos ?? 0), 0),
  [serializedItems]);

  const update = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="budgetId" value={budget?.id ?? ""} />
      <input type="hidden" name="items" value={JSON.stringify(serializedItems)} />

      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <div className="min-w-0 md:col-span-2">
            {patient ? (
              <>
                <input type="hidden" name="patientId" value={patient.id} />
                <div className="rounded-md bg-secondary px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Paciente: </span>
                  <span className="font-medium">{patient.nome}</span>
                </div>
              </>
            ) : (
              <PatientPicker searchLabel="Buscar paciente para orçamento" error={state.fieldErrors?.patientId} />
            )}
          </div>
          <label className="min-w-0 text-sm">
            Profissional responsável
            <select
              name="professionalId"
              required
              disabled={!editable}
              defaultValue={budget?.profissional_id ?? ""}
              aria-invalid={Boolean(state.fieldErrors?.professionalId)}
              className="mt-1 block h-11 w-full min-w-0 rounded border bg-background px-3 text-base disabled:opacity-60 sm:text-sm"
            >
              <option value="">Selecione</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>{professional.nome}</option>
              ))}
            </select>
            {state.fieldErrors?.professionalId && (
              <span className="mt-1 block text-xs text-destructive">{state.fieldErrors.professionalId}</span>
            )}
          </label>
          <label className="min-w-0 text-sm">
            Validade{editable && <span className="text-muted-foreground"> (obrigatória ao enviar)</span>}
            <input
              name="validity"
              type="date"
              disabled={!editable}
              defaultValue={budget?.validade_em ?? ""}
              aria-invalid={Boolean(state.fieldErrors?.validity)}
              className="mt-1 block h-11 w-full min-w-0 max-w-full rounded border bg-background px-3 text-base disabled:opacity-60 sm:text-sm"
            />
            {state.fieldErrors?.validity && (
              <span className="mt-1 block text-xs text-destructive">{state.fieldErrors.validity}</span>
            )}
          </label>
          <label className="min-w-0 text-sm md:col-span-2">
            Observação administrativa
            <textarea
              name="observation"
              maxLength={1000}
              disabled={!editable}
              defaultValue={budget?.observacao_administrativa ?? ""}
              className="mt-1 block min-h-24 w-full rounded border bg-background p-3 text-base disabled:opacity-60 sm:text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">Itens</h3>
            <p className="mt-1 text-xs text-muted-foreground">Informe valores em reais, por exemplo 200,00.</p>
          </div>
          {editable && (
            <button
              type="button"
              onClick={() => setItems((current) => [...current, newItem()])}
              className="inline-flex min-h-10 items-center gap-1 rounded border px-3 text-sm hover:bg-secondary"
            >
              <Plus className="h-4 w-4" /> Adicionar item
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          {items.map((item, index) => item.removed ? null : (
            <div key={item.id ?? `new-${index}`} className="grid min-w-0 gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_6rem_9rem_auto]">
              <input
                aria-label={`Descrição do item ${index + 1}`}
                disabled={!editable}
                value={item.descricao}
                maxLength={300}
                onChange={(event) => update(index, { descricao: event.target.value })}
                placeholder="Descrição"
                className="h-11 w-full min-w-0 rounded border bg-background px-3 text-base disabled:opacity-60 sm:text-sm"
              />
              <input
                aria-label={`Quantidade do item ${index + 1}`}
                disabled={!editable}
                value={item.quantidade}
                min="1"
                max="999"
                type="number"
                onChange={(event) => update(index, { quantidade: Number(event.target.value) })}
                className="h-11 w-full min-w-0 rounded border bg-background px-3 text-base disabled:opacity-60 sm:text-sm"
              />
              <input
                aria-label={`Valor unitário do item ${index + 1} em reais`}
                disabled={!editable}
                value={item.valorUnitarioReais}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                maxLength={18}
                placeholder="200,00"
                aria-invalid={parseReaisToCents(item.valorUnitarioReais) === null}
                onChange={(event) => update(index, { valorUnitarioReais: event.target.value })}
                className="h-11 w-full min-w-0 rounded border bg-background px-3 text-base disabled:opacity-60 sm:text-sm"
              />
              {editable && (
                <button
                  type="button"
                  aria-label={`Remover item ${index + 1}`}
                  onClick={() => update(index, { removed: true })}
                  className="inline-flex h-11 w-11 items-center justify-center rounded border text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {state.fieldErrors?.items && (
          <p role="alert" className="mt-3 text-sm text-destructive">{state.fieldErrors.items}</p>
        )}
        <div className="mt-4 flex justify-end border-t pt-4 text-base font-semibold">
          Total: {formatCents(total)}
        </div>
      </section>

      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="submit" name="desiredStatus" value="rascunho" disabled={pending} className="h-11 rounded border px-4 text-sm font-medium hover:bg-secondary">
            Salvar rascunho
          </button>
          <button type="submit" name="desiredStatus" value="enviado" disabled={pending} className="h-11 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            {pending ? "Salvando..." : "Salvar e enviar"}
          </button>
        </div>
      )}
    </form>
  );
}
