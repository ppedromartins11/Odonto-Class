"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Search, Bell, Plus } from "lucide-react";
import type { UsuarioAtual } from "@/lib/auth/session";
import { UserMenu } from "./UserMenu";

const ROUTE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  usuarios: "Usuários",
  pacientes: "Pacientes",
  agenda: "Agenda",
  atendimentos: "Atendimento",
};

/**
 * Adaptado de src/app/components/Header.tsx do prototipo. Ajustes
 * aprovados nesta sprint (ver Conflito 4 da analise):
 *  - Busca global: conecta a busca real de pacientes por nome/telefone
 *    implementada na Sprint 2. Consultas continuam fora do escopo.
 *  - "Novo agendamento": ativo para administrador/recepcao depois do bloco
 *    integrado de Agenda; dentista inicia atendimento a partir da propria agenda.
 *  - Sino de notificacao: SEM o indicador vermelho fixo do prototipo,
 *    que sugeria notificacao nao lida sem nenhum sistema real por tras.
 *    Sera conectado a retornos/tarefas/alertas quando esses modulos
 *    existirem.
 *  - Menu do usuario: reimplementado como componente funcional
 *    (UserMenu) com logout de verdade - o prototipo so tinha um botao
 *    estatico sem acao.
 */
export function Header({ usuario }: { usuario: UsuarioAtual }) {
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const title = ROUTE_TITLES[segment] ?? "Dashboard";

  return (
    <header className="fixed left-0 right-0 top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-card px-3 sm:gap-4 md:left-56 md:px-6">
      <h1 className="text-sm font-semibold text-foreground">{title}</h1>

      <form action="/pacientes" className="relative ml-2 hidden max-w-xs flex-1 sm:block md:ml-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="search"
          name="q"
          maxLength={100}
          placeholder="Buscar paciente por nome ou telefone"
          aria-label="Buscar paciente por nome ou telefone"
          className="w-full pl-9 pr-3 py-1.5 text-sm bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </form>

      <div className="flex items-center gap-2 ml-auto">
        {usuario.perfil === "administrador" || usuario.perfil === "recepcao" ? (
          <Link href="/agenda/novo" aria-label="Novo agendamento" className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 sm:px-3">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Novo agendamento</span><span className="sm:hidden">Novo</span>
          </Link>
        ) : null}

        <button
          type="button"
          disabled
          title="Alertas serão conectados a retornos/tarefas/validade em sprints futuras"
          className="relative w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground/50 cursor-not-allowed"
        >
          <Bell className="w-4 h-4" />
        </button>

        <UserMenu usuario={usuario} />
      </div>
    </header>
  );
}
