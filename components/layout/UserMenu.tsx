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
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Menu de ${usuario.nome}`}
        className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1 transition-colors hover:bg-secondary sm:pl-2"
      >
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-white font-semibold">
            {initials(usuario.nome)}
          </span>
        </div>
        <span className="hidden max-w-36 truncate text-sm font-medium text-foreground md:block">{usuario.nome}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-border bg-popover py-1 shadow-lg">
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
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-secondary"
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
