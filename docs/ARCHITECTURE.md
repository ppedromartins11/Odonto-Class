# Arquitetura

## Stack aprovada

- **Next.js (App Router) + TypeScript** - front-end e back-end
  (server actions/API routes) no mesmo projeto.
- **Tailwind CSS v4** - configuracao CSS-first (`@theme` no CSS, sem
  `tailwind.config.js`).
- **Supabase** - Postgres gerenciado + Auth + Storage + Row Level
  Security nativa.
- **Vercel** - deploy.
- **npm** como gerenciador de pacotes.

## Justificativa

Volume da clinica (5 usuarios, 11-30 pacientes/semana) nao justifica
microservicos, Redis ou multiplos backends. Um monolito modular no
Next.js atende aos requisitos de desempenho (RNF-04) com menor risco
operacional. Supabase cobre autenticacao (RF-01/RF-02), armazenamento de
arquivos/PDFs (RF-11/RF-19) e permite RLS nativa para isolamento de
dados clinicos (RN-05) sem duplicar logica de autorizacao. Vercel integra
nativamente com o repositorio Git para deploy continuo, atendendo
RNF-09 (manutenibilidade).

## Modulos funcionais

Dashboard, Agenda, Pacientes, Prontuario/Historico, Atendimentos/
Procedimentos, Documentos e Atestados, Retornos, Tarefas, Pagamentos,
Orcamentos, Validade/Esterilizacao, Usuarios e Permissoes. Objetivo,
telas e dependencias de cada modulo estao descritos no documento de
especificacao aprovado (secao 4) - a implementar a partir da Sprint 2.

## Estado na Sprint 0

Nenhum modulo funcional foi implementado. Existe apenas:
- Scaffold do projeto (Next.js + TypeScript + Tailwind configurados).
- Clientes Supabase base (`lib/supabase/client.ts` e `server.ts`), sem
  logica de autenticacao/sessao.
- Pagina inicial placeholder para validar o deploy vazio.

## Itens de arquitetura ainda nao validados

Ver `docs/DECISIONS.md`, secao "Itens nao validados por falta de
internet" - inclui versoes exatas de dependencias e compatibilidade real
do toolchain (Next 16 + React 19 + Tailwind v4 + TypeScript 5.x), que so
serao confirmadas quando `npm install` for executado em um ambiente com
acesso a rede.
