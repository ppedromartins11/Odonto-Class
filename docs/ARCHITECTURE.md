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

## Estado na Sprint 1.5

- Monolito Next.js 16 em Node 24, com Server Components/Actions e
  `proxy.ts` para renovacao de sessao SSR.
- Tres clientes Supabase separados por confianca: browser (anon), server
  SSR (anon + cookies/RLS) e admin server-only (service role).
- Identidade em `auth.users`; perfil/estado em `public.usuarios`; dados
  de dentista em `profissionais`. Provisionamento e sincronizacao ficam
  no banco para evitar estado parcial.
- Autorizacao de dados permanece no Postgres/RLS. Guards da aplicacao
  melhoram UX, mas nao substituem `is_active_user()`/policies.
- Auditoria minima append-only existe antes dos modulos clinicos.

## Itens de arquitetura ainda nao validados

Toolchain e build foram validados localmente. Falta executar `0001` +
`0002`, lint SQL e a suite RLS em Supabase de homologacao ficticia; este
e o gate arquitetural antes da Sprint 2.
