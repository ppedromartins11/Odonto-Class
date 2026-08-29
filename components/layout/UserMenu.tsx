"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const gutter = 12;
      const left = Math.max(gutter, Math.min(triggerRect.right - width, window.innerWidth - width - gutter));
      const below = triggerRect.bottom + 8;
      const above = triggerRect.top - height - 8;
      const top = below + height <= window.innerHeight - gutter || above < gutter
        ? Math.min(below, window.innerHeight - height - gutter)
        : above;

      setMenuPosition((current) => current.top === top && current.left === left ? current : { top, left });
    };
    const handleClickOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      menuRef.current?.focus();
    });
    const observer = new ResizeObserver(updatePosition);
    if (menuRef.current) observer.observe(menuRef.current);
    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div>
      <button
        ref={triggerRef}
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

      {open && typeof document !== "undefined" && createPortal(
        <div ref={menuRef} role="menu" tabIndex={-1} aria-label="Menu do usuário" style={{ top: menuPosition.top, left: menuPosition.left }} className="fixed z-30 w-52 rounded-md border border-border bg-popover py-1 shadow-lg outline-none">
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
        </div>,
        document.body,
      )}
    </div>
  );
}
