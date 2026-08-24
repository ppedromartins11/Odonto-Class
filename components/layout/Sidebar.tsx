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
  ShieldCheck,
  UserCog,
  Cross,
} from "lucide-react";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import type { UsuarioAtual } from "@/lib/auth/session";

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
  { href: "/financeiro", label: "Financeiro", icon: DollarSign, enabled: false },
  { href: "/orcamentos", label: "Orçamentos", icon: ClipboardList, enabled: false },
  { href: "/validade", label: "Val. e Esterilização", icon: ShieldCheck, enabled: false },
  { href: "/usuarios", label: "Usuários", icon: UserCog, enabled: true, adminOnly: true },
] as const;

export function Sidebar({ usuario }: { usuario: UsuarioAtual }) {
  const activePath = usePathname();

  return (
    <aside className="fixed bottom-0 left-0 z-20 flex h-14 w-full flex-col border-t border-sidebar-border bg-sidebar md:bottom-auto md:top-0 md:h-full md:w-56 md:border-r md:border-t-0">
      <div className="hidden items-center gap-2.5 border-b border-sidebar-border px-5 py-5 md:flex">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <Cross className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-semibold text-sidebar-foreground tracking-tight">
            {CLINIC_NAME}
          </span>
          <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
            {CLINIC_TAGLINE}
          </p>
        </div>
      </div>

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
