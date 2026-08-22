# Changelog

## Sprint 1.5 - Hardening (implementacao local)

- Toolchain alinhado ao Next.js 16: ESLint flat config nativo, Node 24,
  lockfile versionado, `.env.local.example` restaurado e CI com testes.
- `middleware.ts` substituido por `proxy.ts`; cookies/headers SSR e
  anti-cache preservados em respostas e redirects.
- Callback SSR/PKCE para convite e recuperacao, cookie de fluxo HttpOnly
  assinado e tela de redefinicao protegida por sessao/contexto valido.
- Estados separados para sessao ausente, conta inativa, perfil ausente e
  erro temporario, eliminando ciclo entre login e dashboard.
- Migration aditiva `0002`: `is_admin()` endurecida,
  `is_active_user()`, RPC atomica de acesso, triggers de provisionamento/
  e-mail, consistencia de profissionais, regra do ultimo admin e tabela
  append-only `auditoria`.
- Onboarding transacional por metadados de convite; edicao de perfil e
  ativacao/desativacao com RLS + suspensao Auth e compensacao segura.
- Testes unitarios do token de fluxo e suite opt-in de homologacao para
  administrador, dentista, recepcao, inativo e usuario sem perfil.
- Validacao aprovada: lint, typecheck, 3 testes unitarios, build, lint SQL
  remoto e 7 testes de autorizacao/RLS em homologacao ficticia. Historico
  remoto reparado para registrar a `0001` preexistente e `0002` aplicada
  transacionalmente. Sprint 2 nao foi iniciada.

## Sprint 0 - Infraestrutura

- Estrutura inicial de pastas (`app`, `components`, `lib`, `server`,
  `types`, `supabase`, `docs`).
- Projeto Next.js (App Router) + TypeScript + Tailwind CSS v4 montado
  manualmente (sem `create-next-app`, por falta de acesso a internet no
  ambiente de geracao - ver `docs/DECISIONS.md`).
- Clientes Supabase base (`lib/supabase/client.ts`, `server.ts`), sem
  autenticacao/sessao.
- `.env.local.example` com placeholders (sem credenciais reais).
- Documentacao criada: `README.md`, `CLAUDE.md`,
  `docs/{REQUIREMENTS,ARCHITECTURE,DATABASE,SECURITY,TESTING,DEPLOYMENT,TODO,CHANGELOG,DECISIONS}.md`.
- Pagina inicial placeholder (`app/page.tsx`) para validar deploy vazio.
- Workflow de CI (`.github/workflows/ci.yml`): lint + typecheck + build.
- Repositorio Git local inicializado com primeiro commit.
- Nenhuma migration, autenticacao ou funcionalidade de produto criada.

## Sprint 1 - Autenticacao, usuarios e layout global

Analise do prototipo Figma Make (`User_dashboard.zip`) e comparacao com
requisitos/especificacao antes de implementar - ver `docs/DECISIONS.md`
para a tabela de conflitos e as decisoes aprovadas.

Implementado:
- Migration `0001_usuarios_profissionais.sql`: tabelas `usuarios` e
  `profissionais`, com RLS habilitada desde a criacao e funcao auxiliar
  `is_admin()` (`SECURITY DEFINER`) para evitar recursao de RLS.
- Autenticacao Supabase Auth (e-mail + senha), sessao via cookies
  (`@supabase/ssr`), originalmente com `middleware.ts` e posteriormente
  migrada para `proxy.ts` na Sprint 1.5.
- Recuperacao de senha: `/esqueci-senha` (solicitar link) e
  `/redefinir-senha` (definir nova senha).
- Logout real (menu do usuario no Header).
- Layout global (Sidebar + Header) adaptado do prototipo Figma Make:
  cores, tipografia, radius e estrutura preservados; "Atendimentos" e
  "Configuracoes" removidos do menu (decisoes aprovadas); modulos ainda
  nao implementados aparecem desabilitados ("em breve") em vez de link
  morto ou pagina placeholder; busca global e sino de notificacao
  mantidos so visualmente, sem funcionalidade ficticia nem badge falso.
- `/dashboard`: casca minima autenticada (sem KPIs/dados ficticios).
- `/usuarios` (RF-02): listagem real via Supabase + criacao de usuario
  por convite administrativo (Supabase Admin API, chave de servico
  isolada em `lib/supabase/admin.ts`), com criacao automatica do
  registro em `profissionais` quando o perfil e "dentista".
- Componentes de UI proprios (`Button`, `Input`, `Badge`) - nenhuma
  dependencia do pacote shadcn/Radix/MUI do prototipo foi trazida (ver
  auditoria de dependencias em `docs/DECISIONS.md`).
- Fonte Inter migrada para `next/font/google` (auto-hospedada, sem
  chamada externa em runtime).

Nao implementado **na Sprint 1 original** (resolvido ou reavaliado na
Sprint 1.5 quando indicado):
por falta de requisito aprovado):
- Edicao/desativacao de usuario (adicionada na Sprint 1.5).
- MFA (continua gate de go-live) e auditoria minima (adicionada na 1.5).
- Qualquer modulo alem de Usuarios (Agenda, Pacientes, etc.).
- A validacao de toolchain que falhou naquele ambiente foi concluida na
  Sprint 1.5.
