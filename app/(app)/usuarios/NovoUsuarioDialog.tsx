"use client";

import { useState, useTransition } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createUsuario } from "./actions";
import type { CreateUsuarioState } from "./types";

const initialState: CreateUsuarioState = { error: null, success: false };

const PERFIS = [
  { value: "administrador", label: "Administrador(a)" },
  { value: "dentista", label: "Dentista" },
  { value: "recepcao", label: "Recepção" },
] as const;

export function NovoUsuarioDialog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();

  function openDialog() {
    setState(initialState);
    setOpen(true);
  }

  function submitAction(formData: FormData) {
    startTransition(async () => {
      const nextState = await createUsuario(initialState, formData);
      setState(nextState);

      if (nextState.success) {
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button onClick={openDialog} size="sm">
        <Plus className="w-3.5 h-3.5" />
        Novo usuário
      </Button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm bg-card border border-border rounded-lg shadow-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-card-foreground">
                Novo usuário
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form action={submitAction} className="space-y-4">
              <div>
                <label htmlFor="nome" className="block mb-1.5 text-foreground">
                  Nome completo
                </label>
                <Input id="nome" name="nome" required placeholder="Nome do usuário" />
              </div>

              <div>
                <label htmlFor="email" className="block mb-1.5 text-foreground">
                  E-mail
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="usuario@clinica.com"
                />
              </div>

              <div>
                <label htmlFor="perfil" className="block mb-1.5 text-foreground">
                  Perfil
                </label>
                <select
                  id="perfil"
                  name="perfil"
                  required
                  defaultValue=""
                  className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>
                    Selecione um perfil
                  </option>
                  {PERFIS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {state.error && (
                <p role="alert" className="text-sm text-destructive">
                  {state.error}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                O usuário recebe um convite por e-mail e define a própria
                senha ao aceitar.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Enviando convite..." : "Enviar convite"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
