"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import type { UsuarioAtual } from "@/lib/auth/session";

const PERFIL_LABEL: Record<UsuarioAtual["perfil"], string> = {
  administrador: "Administrador(a)",
  dentista: "Dentista",
  recepcao: "Recepção",
};

function initials(nome: string) {
  const parts = nome.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function UserMenu({ usuario }: { usuario: UsuarioAtual }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-md hover:bg-secondary transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-white font-semibold">
            {initials(usuario.nome)}
          </span>
        </div>
        <span className="text-sm font-medium text-foreground">{usuario.nome}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-popover border border-border rounded-md shadow-md py-1 z-30">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-popover-foreground truncate">
              {usuario.nome}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {PERFIL_LABEL[usuario.perfil]}
            </p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-secondary text-left"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
