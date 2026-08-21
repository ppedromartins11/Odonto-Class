# Clinica Odontologica - MVP v1

Sistema de gestao para uma clinica odontologica real (agenda, pacientes,
prontuario, documentos, retornos, tarefas, pagamentos, orcamento e
controle de validade/esterilizacao).

> Status atual: **Sprint 1 concluída** (autenticação + usuários).
> Login, recuperação de senha, layout global (Sidebar/Header) e o módulo
> de Usuários estão implementados e funcionais assim que as credenciais
> reais do Supabase forem configuradas. Os demais módulos aparecem no
> menu como "em breve". Ver `CLAUDE.md` para as regras do projeto e
> `docs/TODO.md` para o roadmap completo.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Supabase (Postgres + Auth + Storage + RLS)
- Deploy: Vercel

Justificativa completa em `docs/ARCHITECTURE.md`.

## Estrutura do projeto

```
app/            rotas Next.js (App Router)
  login/                tela de login
  esqueci-senha/        solicitar redefinição de senha
  redefinir-senha/      definir nova senha (link recebido por e-mail)
  (app)/                area autenticada (layout com Sidebar+Header)
    dashboard/           casca minima autenticada
    usuarios/             RF-02 - listagem e criacao de usuario
components/
  layout/          Sidebar, Header, UserMenu (adaptados do prototipo Figma Make)
  ui/              Button, Input, Badge - componentes proprios, sem shadcn/Radix
lib/
  auth/            helpers de sessao/RBAC (session.ts) e logout (actions.ts)
  config/          lib/config/clinic.ts - nome da clinica (ver nota abaixo)
  supabase/        clientes Supabase (client/server/admin)
middleware.ts      protecao de rota + refresh de sessao
supabase/          migrations e seed
docs/           documentacao viva do projeto
```

## Nome da clínica

`lib/config/clinic.ts` usa um nome placeholder (`"Clínica Odontológica"`)
porque o nome real não foi informado em nenhuma fonte do projeto. Edite
esse arquivo com o nome real antes de ir para produção.

## Como rodar localmente (apos a Sprint 0)

Estes passos precisam ser executados por voce, fora deste ambiente de
geracao de codigo, pois exigem acesso a internet e a suas credenciais:

1. Instalar dependencias:
   ```
   npm install
   ```
2. Criar um projeto em [supabase.com](https://supabase.com) e copiar a
   URL e as chaves (Project Settings > API).
3. Copiar `.env.local.example` para `.env.local` e preencher com os
   valores reais, incluindo `SUPABASE_SERVICE_ROLE_KEY` (necessária para
   o convite de novos usuários) e `NEXT_PUBLIC_SITE_URL`:
   ```
   cp .env.local.example .env.local
   ```
4. Rodar a migration `supabase/migrations/0001_usuarios_profissionais.sql`
   contra o projeto Supabase (SQL Editor ou CLI).
5. Configurar em Auth > URL Configuration (painel do Supabase) a
   Redirect URL `<sua-url>/redefinir-senha` - necessária para a
   recuperação de senha funcionar.
6. Criar manualmente o primeiro usuário administrador (Auth > Invite
   user no painel + inserir a linha correspondente em `usuarios` com
   `perfil = 'administrador'`) - não há autocadastro pela aplicação.
7. Rodar o projeto:
   ```
   npm run dev
   ```
8. Abrir `http://localhost:3000` - deve redirecionar para `/login`.

## Documentacao

| Arquivo | Conteudo |
|---|---|
| `CLAUDE.md` | Regras do projeto para desenvolvimento assistido por IA |
| `docs/REQUIREMENTS.md` | Requisitos funcionais e regras de negocio |
| `docs/ARCHITECTURE.md` | Stack e decisoes de arquitetura |
| `docs/DATABASE.md` | Modelo de dados e ERD |
| `docs/SECURITY.md` | Seguranca, RLS e LGPD |
| `docs/TESTING.md` | Estrategia de testes e criterios de aceitacao |
| `docs/DEPLOYMENT.md` | Processo de deploy e checklist pos-Sprint 0 |
| `docs/TODO.md` | Roadmap por sprint |
| `docs/CHANGELOG.md` | Historico de mudancas |
| `docs/DECISIONS.md` | Registro de decisoes tecnicas (ADR) |

## Importante

Este projeto nunca deve conter dados reais de pacientes em ambiente de
desenvolvimento ou teste. Ver `docs/SECURITY.md`.
