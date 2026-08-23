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
especificacao aprovado (secao 4) - implementados incrementalmente.

## Estado apos a implementacao local da Sprint 2

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
- Pacientes usa Server Components/Actions para UI e RPCs transacionais
  para escrita. Dados administrativos e alertas clinicos atuais ficam em
  tabelas distintas, permitindo RLS por finalidade sem criar prontuario.
- Busca por nome/telefone roda no banco, paginada e compativel com RLS.
- Agenda, atendimento e procedimentos permanecem no mesmo monolito modular.
  A UI usa Server Components/Actions e um endpoint interno no-store apenas
  para a busca incremental de pacientes; nenhuma lista grande vai ao client.
- A concorrencia de agenda e resolvida no PostgreSQL por exclusion constraint,
  nao por estado em memoria. RPCs concentram transicoes e auditoria atomica.
- Tabelas clinicas ficam separadas da agenda administrativa; o banco nao
  retorna evolucao/procedimentos a admin, recepcao ou outro dentista.

## Itens de arquitetura ainda nao validados

`0001`, `0002` e `0003` estao aplicadas na homologacao ficticia. O lint SQL
nao encontrou erros e as suites RLS/RPC por perfil passaram. O modelo atual
nao representa multiplos papeis simultaneos; por isso administrador puro nao
recebe acesso clinico.
