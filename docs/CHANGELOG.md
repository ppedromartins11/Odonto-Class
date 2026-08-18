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
