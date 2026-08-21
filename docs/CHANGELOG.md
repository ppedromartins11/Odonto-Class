# Changelog

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
  (`@supabase/ssr`), refresh e protecao de rota em `middleware.ts`.
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

Nao implementado nesta sprint (fora de escopo, adiado por decisao ou
por falta de requisito aprovado):
- Edicao/desativacao de usuario (so listagem + criacao).
- MFA (PAV-20), lista fechada de eventos de auditoria (PAV-18, tabela
  `auditoria` nao existe ainda).
- Qualquer modulo alem de Usuarios (Agenda, Pacientes, etc.).
- `npm install`/`npm run lint`/`npm run build` nao executados com
  sucesso neste ambiente - ver `docs/DECISIONS.md` para o resultado
  exato da tentativa.
