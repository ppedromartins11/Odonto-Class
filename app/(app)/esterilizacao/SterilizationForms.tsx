"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialDomainActionState } from "@/lib/validity/types";
import {
  createEquipment,
  createPackage,
  finishCycle,
  setEquipmentActive,
  setPackageStatus,
  startCycle,
  updateEquipment,
} from "./actions";

function Feedback({ state }: { state: typeof initialDomainActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state.success && <p role="status" className="text-sm text-emerald-700">Operação concluída.</p>}</>;
}

export function EquipmentForm() {
  const [state, action, pending] = useActionState(createEquipment, initialDomainActionState);
  return <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div><h3 className="font-medium">Novo equipamento</h3><p className="mt-1 text-xs text-muted-foreground">Cadastro administrativo de autoclaves e equipamentos do processo.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">Nome<Input name="nome" required minLength={2} maxLength={150} /></label>
      <label className="text-sm font-medium">Identificação<Input name="identificacao" required minLength={2} maxLength={100} /></label>
      <label className="text-sm font-medium">Modelo <span className="font-normal text-muted-foreground">(opcional)</span><Input name="modelo" maxLength={120} /></label>
      <label className="text-sm font-medium">Fabricante <span className="font-normal text-muted-foreground">(opcional)</span><Input name="fabricante" maxLength={120} /></label>
      <label className="text-sm font-medium">Número de série <span className="font-normal text-muted-foreground">(opcional)</span><Input name="numeroSerie" maxLength={120} /></label>
    </div>
    <Feedback state={state} /><Button disabled={pending}>{pending ? "Salvando..." : "Cadastrar equipamento"}</Button>
  </form>;
}

export function EquipmentActiveForm({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setEquipmentActive, initialDomainActionState);
  return <form action={action} className="flex flex-wrap items-center gap-2"><input type="hidden" name="equipmentId" value={id} /><input type="hidden" name="active" value={String(!active)} /><Button size="sm" variant="secondary" disabled={pending}>{active ? "Inativar" : "Reativar"}</Button>{state.error && <span role="alert" className="text-xs text-destructive">{state.error}</span>}</form>;
}

type Equipment = { id: string; nome: string; identificacao: string; modelo: string | null; fabricante: string | null; numero_serie: string | null };

function EquipmentEditForm({ equipment, onClose }: { equipment: Equipment; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateEquipment, initialDomainActionState);
  const initialFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { initialFieldRef.current?.focus(); }, []);
  useEffect(() => {
    if (state.success) onClose();
  }, [onClose, state.success]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-equipment-title" className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
      <form action={action} className="space-y-4">
        <input type="hidden" name="equipmentId" value={equipment.id} />
        <div className="flex items-start justify-between gap-3"><div><h3 id="edit-equipment-title" className="font-medium">Editar equipamento</h3><p className="mt-1 text-xs text-muted-foreground">Corrija os dados administrativos sem alterar ciclos ou pacotes já registrados.</p></div><Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending} aria-label="Fechar edição">Fechar</Button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Nome<Input ref={initialFieldRef} name="nome" required minLength={2} maxLength={150} defaultValue={equipment.nome} /></label>
          <label className="text-sm font-medium">Identificação<Input name="identificacao" required minLength={2} maxLength={100} defaultValue={equipment.identificacao} /></label>
          <label className="text-sm font-medium">Modelo <span className="font-normal text-muted-foreground">(opcional)</span><Input name="modelo" maxLength={120} defaultValue={equipment.modelo ?? ""} /></label>
          <label className="text-sm font-medium">Fabricante <span className="font-normal text-muted-foreground">(opcional)</span><Input name="fabricante" maxLength={120} defaultValue={equipment.fabricante ?? ""} /></label>
          <label className="text-sm font-medium sm:col-span-2">Número de série <span className="font-normal text-muted-foreground">(opcional)</span><Input name="numeroSerie" maxLength={120} defaultValue={equipment.numero_serie ?? ""} /></label>
        </div>
        <Feedback state={state} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button><Button disabled={pending}>{pending ? "Salvando..." : "Salvar alterações"}</Button></div>
      </form>
    </div>
  </div>;
}

export function EquipmentEditDialog({ equipment }: { equipment: Equipment }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const close = () => setOpen(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  return <><Button ref={triggerRef} type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Editar</Button>{open && <EquipmentEditForm equipment={equipment} onClose={close} />}</>;
}

export function StartCycleForm({ equipment }: { equipment: Array<{ id: string; nome: string; identificacao: string }> }) {
  const [state, action, pending] = useActionState(startCycle, initialDomainActionState);
  return <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div><h3 className="font-medium">Iniciar ciclo</h3><p className="mt-1 text-xs text-muted-foreground">Selecione um equipamento ativo. Os pacotes serão vinculados ao ciclo.</p></div>
    <label className="block text-sm font-medium">Equipamento<select name="equipmentId" required className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm"><option value="">Selecione</option>{equipment.map(item => <option key={item.id} value={item.id}>{item.nome} · {item.identificacao}</option>)}</select></label>
    <label className="block text-sm font-medium">Observações <span className="font-normal text-muted-foreground">(opcional)</span><textarea name="observacoes" maxLength={1000} rows={3} className="mt-1 w-full rounded-md border border-border bg-input-background p-2 text-sm" /></label>
    <Feedback state={state} /><Button disabled={pending || equipment.length === 0}>{pending ? "Iniciando..." : "Iniciar ciclo"}</Button>
  </form>;
}

export function PackageForm({ cycleId }: { cycleId: string }) {
  const [state, action, pending] = useActionState(createPackage, initialDomainActionState);
  return <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-5"><input type="hidden" name="cycleId" value={cycleId} />
    <div><h3 className="font-medium">Adicionar pacote</h3><p className="mt-1 text-xs text-muted-foreground">A validade é informada manualmente e deve ser igual ou posterior à esterilização.</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Código<Input name="codigo" required minLength={2} maxLength={100} /></label><label className="text-sm font-medium">Validade<Input name="validade" type="date" required /></label><label className="text-sm font-medium sm:col-span-2">Descrição<Input name="descricao" required minLength={2} maxLength={300} /></label></div>
    <Feedback state={state} /><Button disabled={pending}>{pending ? "Adicionando..." : "Adicionar pacote"}</Button>
  </form>;
}

export function FinishCycleForm({ cycleId }: { cycleId: string }) {
  const [state, action, pending] = useActionState(finishCycle, initialDomainActionState);
  return <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-5"><input type="hidden" name="cycleId" value={cycleId} /><h3 className="font-medium">Encerrar ciclo</h3><label className="block text-sm font-medium">Resultado<select name="status" required className="mt-1 h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm"><option value="concluido">Concluído</option><option value="reprovado">Reprovado</option><option value="cancelado">Cancelado</option></select></label><label className="block text-sm font-medium">Observações <span className="font-normal text-muted-foreground">(opcional)</span><textarea name="observacoes" maxLength={1000} rows={3} className="mt-1 w-full rounded-md border border-border bg-input-background p-2 text-sm" /></label><Feedback state={state} /><Button disabled={pending}>{pending ? "Encerrando..." : "Encerrar ciclo"}</Button></form>;
}

export function PackageStatusForm({ packageId, cycleId, status }: { packageId: string; cycleId: string; status: "utilizado" | "descartado" }) {
  const [state, action, pending] = useActionState(setPackageStatus, initialDomainActionState);
  return <form action={action} className="inline-flex items-center gap-2"><input type="hidden" name="packageId" value={packageId} /><input type="hidden" name="cycleId" value={cycleId} /><input type="hidden" name="status" value={status} /><Button size="sm" variant="secondary" disabled={pending}>{status === "utilizado" ? "Marcar utilizado" : "Descartar"}</Button>{state.error && <span role="alert" className="text-xs text-destructive">{state.error}</span>}</form>;
}
