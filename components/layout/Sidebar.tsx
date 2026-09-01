"use client";

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
} from "lucide-react";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import type { UsuarioAtual } from "@/lib/auth/session";
import { BrandLogo } from "@/components/brand/BrandLogo";

/**
 * Estrutura e visual adaptados de src/app/components/Sidebar.tsx do
 * prototipo Figma Make. Duas mudancas de escopo aprovadas nesta sprint:
 *  - "Atendimentos" removido do menu principal (Conflito 3 da analise -
 *    atendimento so sera acessivel a partir do paciente).
 *  - "Configuracoes" removido (Conflito 2 - sem requisito aprovado).
 * Pacientes foi ativado na Sprint 2 e Agenda no bloco clinico integrado. Os demais modulos sem
 * rota aparecem desabilitados ("em breve") em vez de
 * virarem link morto ou pagina placeholder (ver plano da Sprint 1).
 */
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, enabled: true },
  { href: "/pacientes", label: "Pacientes", icon: Users, enabled: true },
  { href: "/documentos", label: "Documentos", icon: FileText, enabled: true },
  { href: "/retornos", label: "Retornos", icon: RotateCcw, enabled: true },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare, enabled: true },
  { href: "/financeiro", label: "Financeiro", icon: DollarSign, enabled: true },
  { href: "/estoque", label: "Estoque", icon: Boxes, enabled: true },
  { href: "/servicos", label: "Serviços", icon: Wrench, enabled: true, adminOnly: true },
  { href: "/orcamentos", label: "Orçamentos", icon: ClipboardList, enabled: true },
  { href: "/validade", label: "Validade e lotes", icon: ShieldCheck, enabled: true },
  { href: "/esterilizacao", label: "Esterilização", icon: RefreshCw, enabled: true },
  { href: "/usuarios", label: "Usuários", icon: UserCog, enabled: true, adminOnly: true },
] as const;

export function Sidebar({ usuario }: { usuario: UsuarioAtual }) {
  const activePath = usePathname();

  return (
    <aside className="fixed bottom-0 left-0 z-20 flex h-14 w-full flex-col border-t border-sidebar-border bg-sidebar md:bottom-auto md:top-0 md:h-full md:w-56 md:border-r md:border-t-0">
      <Link href="/dashboard" aria-label={`${CLINIC_NAME} — ir ao Dashboard`} className="hidden items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5 transition-colors hover:bg-secondary/50 md:flex">
        <BrandLogo variant="mark" className="w-11 shrink-0 rounded-md" priority />
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            {CLINIC_NAME}
          </span>
          <p className="mt-0.5 truncate text-[10px] leading-none text-muted-foreground">
            {CLINIC_TAGLINE}
          </p>
        </div>
      </Link>

      <nav className="flex-1 overflow-x-auto py-1 md:overflow-y-auto md:py-3">
        <div className="flex h-full items-center gap-1 px-2 md:block md:h-auto md:space-y-0.5 md:px-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePath.startsWith(item.href);

            if ("adminOnly" in item && item.adminOnly && usuario.perfil !== "administrador") {
              return null;
            }

            if (!item.enabled) {
              return (
                <div
                  key={item.href}
                  aria-disabled="true"
                  title="Em breve - ainda não implementado"
                  className="hidden w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground/50 cursor-not-allowed select-none md:flex"
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/50">
                    em breve
                  </span>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-20 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-xs transition-colors duration-150 md:w-full md:min-w-0 md:flex-row md:justify-start md:gap-2.5 md:px-3 md:py-2 md:text-left md:text-sm ${
                  isActive
                    ? "bg-accent text-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-primary" : ""}`} />
                <span className="truncate">{item.label}</span>
                {isActive && (
                  <span className="hidden ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 md:block" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

    </aside>
  );
}
