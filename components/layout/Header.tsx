"use client";

import Link from "next/link";
import { Search, Plus } from "lucide-react";
import type { UsuarioAtual } from "@/lib/auth/session";
import { UserMenu } from "./UserMenu";

/**
 * Adaptado de src/app/components/Header.tsx do prototipo. Ajustes
 * aprovados nesta sprint (ver Conflito 4 da analise):
 *  - Busca global: conecta a busca real de pacientes por nome/telefone
 *    implementada na Sprint 2. Consultas continuam fora do escopo.
 *  - "Novo agendamento": ativo para administrador/recepcao depois do bloco
 *    integrado de Agenda; dentista inicia atendimento a partir da propria agenda.
 *  - Menu do usuario: reimplementado como componente funcional
 *    (UserMenu) com logout de verdade - o prototipo so tinha um botao
 *    estatico sem acao.
 */
export function Header({ usuario }: { usuario: UsuarioAtual }) {
  return (
    <header className="fixed left-0 right-0 top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 shadow-sm backdrop-blur sm:gap-3 md:left-56 md:px-6">
      <Link href="/pacientes" aria-label="Buscar paciente" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground sm:hidden">
        <Search className="h-4 w-4" />
      </Link>
      <form action="/pacientes" className="relative hidden w-full max-w-md sm:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="search"
          name="q"
          maxLength={100}
          placeholder="Buscar paciente por nome ou telefone"
          aria-label="Buscar paciente por nome ou telefone"
          className="h-9 w-full rounded-md border border-border bg-secondary/70 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:bg-card"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        {usuario.perfil === "administrador" || usuario.perfil === "recepcao" ? (
          <Link href="/agenda/novo" aria-label="Novo agendamento" className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 sm:px-3">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Novo agendamento</span><span className="sm:hidden">Novo</span>
          </Link>
        ) : null}

        <UserMenu usuario={usuario} />
      </div>
    </header>
  );
}
