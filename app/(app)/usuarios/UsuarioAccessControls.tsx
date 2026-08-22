"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { PerfilUsuario } from "@/lib/auth/session";
import { updateUsuarioAccess } from "./actions";

type Props = {
  usuarioId: string;
  perfilAtual: PerfilUsuario;
  statusAtual: "ativo" | "inativo";
  isCurrentUser: boolean;
};

const PERFIS: Array<{ value: PerfilUsuario; label: string }> = [
  { value: "administrador", label: "Administrador" },
  { value: "dentista", label: "Dentista" },
  { value: "recepcao", label: "Recepção" },
];

export function UsuarioAccessControls({
  usuarioId,
  perfilAtual,
  statusAtual,
  isCurrentUser,
}: Props) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(perfilAtual);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runUpdate(values: { perfil?: PerfilUsuario; status?: "ativo" | "inativo" }) {
    const formData = new FormData();
    formData.set("usuarioId", usuarioId);
    if (values.perfil) formData.set("perfil", values.perfil);
    if (values.status) formData.set("status", values.status);

    setError(null);
    startTransition(async () => {
      const result = await updateUsuarioAccess(formData);
      setError(result.error);
      if (result.success) router.refresh();
    });
  }

  return (
    <div className="min-w-56 space-y-2">
      <div className="flex items-center gap-2">
        <select
          aria-label="Perfil do usuário"
          value={perfil}
          disabled={isPending || isCurrentUser}
          onChange={(event) => setPerfil(event.target.value as PerfilUsuario)}
          className="h-8 rounded-md border border-border bg-input-background px-2 text-xs text-foreground disabled:opacity-60"
        >
          {PERFIS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPending || isCurrentUser || perfil === perfilAtual}
          onClick={() => runUpdate({ perfil })}
        >
          Salvar perfil
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={isPending || isCurrentUser}
        onClick={() =>
          runUpdate({ status: statusAtual === "ativo" ? "inativo" : "ativo" })
        }
      >
        {statusAtual === "ativo" ? "Desativar acesso" : "Reativar acesso"}
      </Button>
      {isCurrentUser && (
        <p className="text-xs text-muted-foreground">Sua própria conta é protegida.</p>
      )}
      {error && (
        <p role="alert" className="max-w-72 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
