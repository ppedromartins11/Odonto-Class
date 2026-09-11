"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { initialTreatmentPlanActionState } from "@/lib/treatments/types";
import { cancelTreatmentPlan, convertBudgetToTreatmentPlan } from "./actions";

type DialogCopy = { title: string; description: string; confirm: string };

function ConfirmationDialog({ open, onClose, copy, action, pending, error, children }: {
  open: boolean;
  onClose: () => void;
  copy: DialogCopy;
  action: (payload: FormData) => void;
  pending: boolean;
  error: string | null;
  children: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, pending]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="treatment-dialog-title" aria-describedby="treatment-dialog-description" className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 id="treatment-dialog-title" className="text-lg font-semibold text-foreground">{copy.title}</h3>
        <p id="treatment-dialog-description" className="mt-2 text-sm leading-6 text-muted-foreground">{copy.description}</p>
        <form action={action} className="mt-5 space-y-4">
          {children}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={cancelRef} type="button" variant="secondary" onClick={onClose} disabled={pending}>Voltar</Button>
            <Button disabled={pending}>{pending ? "Processando..." : copy.confirm}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function BudgetTreatmentAction({ budgetId, planId, canConvert }: { budgetId: string; planId: string | null; canConvert: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(convertBudgetToTreatmentPlan, initialTreatmentPlanActionState);
  const close = () => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); };
  if (planId || state.planId) {
    return <Link href={`/tratamentos/${planId ?? state.planId}`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Ver plano de tratamento</Link>;
  }
  if (!canConvert) return null;
  return <>
    <Button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Converter em tratamento</Button>
    <ConfirmationDialog open={open} onClose={close} action={action} pending={pending} error={state.error} copy={{ title: "Converter em plano de tratamento", description: "Converter este orçamento em plano de tratamento? Os itens serão criados como planejados. Nenhum procedimento será registrado como realizado nesta etapa.", confirm: "Converter orçamento" }}>
      <input type="hidden" name="budgetId" value={budgetId} />
    </ConfirmationDialog>
  </>;
}

export function CancelTreatmentPlanAction({ planId, eligible }: { planId: string; eligible: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelTreatmentPlan, initialTreatmentPlanActionState);
  const close = () => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); };
  if (!eligible) return null;
  return <>
    <Button ref={triggerRef} type="button" variant="secondary" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => setOpen(true)}>Cancelar plano</Button>
    <ConfirmationDialog open={open} onClose={close} action={action} pending={pending} error={state.error} copy={{ title: "Cancelar plano de tratamento", description: "Cancelar este plano de tratamento? O histórico não será excluído. O plano será marcado como cancelado.", confirm: "Cancelar plano" }}>
      <input type="hidden" name="planId" value={planId} />
    </ConfirmationDialog>
  </>;
}
