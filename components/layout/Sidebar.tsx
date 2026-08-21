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
 * Dos 10 itens restantes, so Dashboard e Usuarios tem rota implementada
 * nesta sprint; os demais aparecem desabilitados ("em breve") em vez de
 * virarem link morto ou pagina placeholder (ver plano da Sprint 1).
 */
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, enabled: false },
  { href: "/pacientes", label: "Pacientes", icon: Users, enabled: false },
  { href: "/documentos", label: "Documentos", icon: FileText, enabled: false },
  { href: "/retornos", label: "Retornos", icon: RotateCcw, enabled: false },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare, enabled: false },
  { href: "/financeiro", label: "Financeiro", icon: DollarSign, enabled: false },
  { href: "/orcamentos", label: "Orçamentos", icon: ClipboardList, enabled: false },
  { href: "/validade", label: "Val. e Esterilização", icon: ShieldCheck, enabled: false },
  { href: "/usuarios", label: "Usuários", icon: UserCog, enabled: true },
] as const;

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

export function Sidebar({ usuario }: { usuario: UsuarioAtual }) {
  const activePath = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-56 bg-sidebar border-r border-sidebar-border flex flex-col z-20">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sidebar-border">
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

      <nav className="flex-1 py-3 overflow-y-auto">
        <div className="space-y-0.5 px-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePath.startsWith(item.href);

            if (!item.enabled) {
              return (
                <div
                  key={item.href}
                  aria-disabled="true"
                  title="Em breve - ainda não implementado"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground/50 cursor-not-allowed select-none"
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
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors duration-150 text-left ${
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-primary" : ""}`} />
                <span className="truncate">{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] text-white font-semibold">
              {initials(usuario.nome)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {usuario.nome}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {PERFIL_LABEL[usuario.perfil]}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
