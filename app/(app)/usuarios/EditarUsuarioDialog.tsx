"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { updateUsuarioProfile } from "./actions";
import type { UpdateUsuarioProfileState } from "./types";

const initialState: UpdateUsuarioProfileState = { error: null, success: false };

type EditableUser = {
  id: string;
  nome: string;
  email: string;
  perfil: "administrador" | "dentista" | "recepcao";
  registroProfissional: string | null;
};

const profileLabel = {
  administrador: "Administrador",
  dentista: "Dentista",
  recepcao: "Recepção",
} as const;

export function EditarUsuarioDialog({ user, openByDefault = false }: { user: EditableUser; openByDefault?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(openByDefault);
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) setOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, pending]);

  function close() {
    if (pending) return;
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function openDialog() {
    setState(initialState);
    setOpen(true);
  }

  function submit(formData: FormData) {
    formData.set("usuarioId", user.id);
    startTransition(async () => {
      const next = await updateUsuarioProfile(formData);
      setState(next);
      if (next.success) {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button ref={triggerRef} type="button" size="sm" variant="secondary" onClick={openDialog} aria-label={`Editar ${user.nome}`}>
        <Pencil className="h-3.5 w-3.5" />Editar
      </Button>
      {open && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div role="dialog" aria-modal="true" aria-labelledby={`edit-user-${user.id}`} className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div><h3 id={`edit-user-${user.id}`} className="text-base font-semibold text-foreground">Editar usuário</h3><p className="mt-1 text-sm text-muted-foreground">Atualize os dados administrativos disponíveis.</p></div>
            <button type="button" onClick={close} disabled={pending} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
          <form action={submit} className="space-y-4">
            <input type="hidden" name="usuarioId" value={user.id} />
            <label className="block text-sm font-medium text-foreground">Nome completo
              <Input ref={nameRef} name="nome" required minLength={2} maxLength={160} defaultValue={user.nome} className="mt-1.5" />
            </label>
            <div><p className="text-sm font-medium text-foreground">E-mail</p><Input value={user.email} readOnly aria-readonly className="mt-1.5 cursor-not-allowed opacity-70" /><p className="mt-1.5 text-xs text-muted-foreground">O e-mail de acesso não pode ser alterado nesta tela.</p></div>
            <div><p className="text-sm font-medium text-foreground">Perfil</p><p className="mt-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{profileLabel[user.perfil]}</p></div>
            {user.perfil === "dentista" && <div className="rounded-lg border border-primary/15 bg-primary/5 p-4"><label className="block text-sm font-medium text-foreground">Registro profissional (CRO)<Input name="registroProfissional" maxLength={80} defaultValue={user.registroProfissional ?? ""} placeholder="CRO-MS 12345" className="mt-1.5 bg-background" /></label>{user.registroProfissional && <p className="mt-2 text-xs text-muted-foreground">Registro atual: <span className="font-medium text-foreground">{user.registroProfissional}</span></p>}</div>}
            {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
            {state.success && <p role="status" className="text-sm text-emerald-700">Usuário atualizado com sucesso.</p>}
            <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? "Salvando..." : "Salvar alterações"}</Button></div>
          </form>
        </div>
      </div>}
    </>
  );
}
