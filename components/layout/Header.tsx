"use client";

import { usePathname } from "next/navigation";
import { Search, Bell, Plus } from "lucide-react";
import type { UsuarioAtual } from "@/lib/auth/session";
import { UserMenu } from "./UserMenu";

const ROUTE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  usuarios: "Usuários",
};

/**
 * Adaptado de src/app/components/Header.tsx do prototipo. Ajustes
 * aprovados nesta sprint (ver Conflito 4 da analise):
 *  - Busca global: presente visualmente, mas desabilitada - sem
 *    funcionalidade ficticia. Buscar paciente de verdade fica para a
 *    Sprint 2 (modulo Pacientes).
 *  - "Nova consulta": desabilitada - Agenda ainda nao existe.
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
    <header className="fixed top-0 left-56 right-0 h-14 bg-card border-b border-border flex items-center gap-4 px-6 z-10">
      <h1 className="text-sm font-semibold text-foreground">{title}</h1>

      <div className="flex-1 max-w-xs relative ml-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          disabled
          placeholder="Buscar paciente, consulta... (em breve)"
          title="Busca disponível a partir da Sprint 2"
          className="w-full pl-9 pr-3 py-1.5 text-sm bg-secondary border border-border rounded-md text-muted-foreground placeholder:text-muted-foreground cursor-not-allowed"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          disabled
          title="Disponível quando o módulo Agenda existir"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/50 text-primary-foreground rounded-md text-sm cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          Nova consulta
        </button>

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
