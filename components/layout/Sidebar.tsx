"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  FileText,
  RotateCcw,
  CheckSquare,
  DollarSign,
  ClipboardList,
  Boxes,
  Wrench,
  ShieldCheck,
  RefreshCw,
  UserCog,
  Menu,
  X,
} from "lucide-react";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import type { UsuarioAtual } from "@/lib/auth/session";
import { BrandLogo } from "@/components/brand/BrandLogo";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, enabled: true },
  { href: "/pacientes", label: "Pacientes", icon: Users, enabled: true },
  { href: "/documentos", label: "Documentos", icon: FileText, enabled: true },
  { href: "/retornos", label: "Retornos", icon: RotateCcw, enabled: true },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare, enabled: true },
  { href: "/financeiro", label: "Financeiro", icon: DollarSign, enabled: true },
  { href: "/estoque", label: "Estoque", icon: Boxes, enabled: true },
  { href: "/servicos", label: "Servi\u00e7os", icon: Wrench, enabled: true, adminOnly: true },
  { href: "/orcamentos", label: "Or\u00e7amentos", icon: ClipboardList, enabled: true },
  { href: "/validade", label: "Validade e lotes", icon: ShieldCheck, enabled: true },
  { href: "/esterilizacao", label: "Esteriliza\u00e7\u00e3o", icon: RefreshCw, enabled: true },
  { href: "/usuarios", label: "Usu\u00e1rios", icon: UserCog, enabled: true, adminOnly: true },
] as const;

const MOBILE_PRIMARY = ["/dashboard", "/agenda", "/pacientes", "/retornos"];

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  usuario,
  menuOpen,
  onMenuOpenChange,
}: {
  usuario: UsuarioAtual;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const activePath = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => !("adminOnly" in item && item.adminOnly && usuario.perfil !== "administrador"));
  const mobileItems = visibleItems.filter((item) => MOBILE_PRIMARY.includes(item.href));
  const moreItems = visibleItems.filter((item) => !MOBILE_PRIMARY.includes(item.href));
  const moreIsActive = moreItems.some((item) => isCurrentPath(activePath, item.href));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onMenuOpenChange(false);
        previousFocus?.focus();
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, onMenuOpenChange]);

  const linkClass = (isActive: boolean, mobile = false) =>
    `flex min-w-0 items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      mobile
        ? "min-h-12 flex-1 flex-col justify-center gap-1 px-1 py-1 text-[11px]"
        : "min-h-11 w-full gap-2.5 px-3 py-2 text-sm"
    } ${isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] flex-col border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:left-0 md:h-full md:w-56 md:border-r md:border-t-0 md:pb-0">
      <Link href="/dashboard" aria-label={`${CLINIC_NAME} — ir ao Dashboard`} className="hidden items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5 transition-colors hover:bg-secondary/50 md:flex">
        <BrandLogo variant="mark" className="w-11 shrink-0 rounded-md" priority />
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight text-sidebar-foreground">{CLINIC_NAME}</span>
          <p className="mt-0.5 truncate text-[10px] leading-none text-muted-foreground">{CLINIC_TAGLINE}</p>
        </div>
      </Link>

      <nav aria-label={"Navega\u00e7\u00e3o principal"} className="hidden flex-1 overflow-y-auto py-3 md:block">
        <div className="space-y-1 px-3">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = isCurrentPath(activePath, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined} className={linkClass(isActive)}>
                <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <nav aria-label={"Navega\u00e7\u00e3o m\u00f3vel"} className="flex min-h-16 items-stretch gap-1 px-2 py-1 md:hidden">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const isActive = isCurrentPath(activePath, item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined} className={linkClass(isActive, true)}>
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          id="mobile-menu-trigger"
          type="button"
          aria-controls="mobile-navigation-panel"
          aria-expanded={menuOpen}
          aria-label="Menu de módulos"
          onClick={() => onMenuOpenChange(!menuOpen)}
          className={`${linkClass(moreIsActive || menuOpen, true)} bg-transparent`}
        >
          <Menu aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Fechar menu de módulos"
            onClick={() => onMenuOpenChange(false)}
            className="fixed inset-0 z-40 bg-slate-950/40 md:hidden"
          />
          <div
            id="mobile-navigation-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
            className="fixed inset-y-0 left-0 z-50 w-[min(21rem,88vw)] overflow-y-auto border-r border-border bg-card px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl md:hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-2 pb-3">
              <h2 id="mobile-navigation-title" className="text-base font-semibold">Menu de módulos</h2>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => onMenuOpenChange(false)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-secondary"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Todos os módulos" className="mt-3 space-y-1">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = isCurrentPath(activePath, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onMenuOpenChange(false)}
                    className={linkClass(isActive)}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </aside>
  );
}
