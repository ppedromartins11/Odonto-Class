# Clinica Odontologica - MVP v1

Sistema de gestao para uma clinica odontologica real (agenda, pacientes,
prontuario, documentos, retornos, tarefas, pagamentos, orcamento e
controle de validade/esterilizacao).

> Status atual: **Sprint 2 homologada com dados ficticios**. Pacientes,
> busca nome/telefone, ficha, alertas clinicos segregados, RPCs e RLS
> passaram no lint SQL e em testes de autorizacao por perfil. MFA de
> administrador continua gate de go-live. Ver `docs/TODO.md`.

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
    pacientes/            RF-04/RF-05 e fundacao do RF-06
components/
  layout/          Sidebar, Header, UserMenu (adaptados do prototipo Figma Make)
  ui/              Button, Input, Badge - componentes proprios, sem shadcn/Radix
lib/
  auth/            helpers de sessao/RBAC (session.ts) e logout (actions.ts)
  config/          lib/config/clinic.ts - nome da clinica (ver nota abaixo)
  supabase/        clientes Supabase (client/server/admin)
proxy.ts           protecao de rota + refresh de sessao (Next.js 16)
supabase/          migrations e seed
docs/           documentacao viva do projeto
```

## Nome da clínica

`lib/config/clinic.ts` usa um nome placeholder (`"Clínica Odontológica"`)
porque o nome real não foi informado em nenhuma fonte do projeto. Edite
esse arquivo com o nome real antes de ir para produção.

## Como rodar localmente

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
4. Usar Node.js 24 e rodar, em ordem, as migrations `0001`, `0002` e `0003` de
   `supabase/migrations/`. Não editar migrations já aplicadas.
5. Configurar em Auth > URL Configuration as URLs permitidas
   `<sua-url>/auth/callback` e `<sua-url>/auth/confirm`. Os templates de
   convite devem enviar `token_hash` para `/auth/confirm`; recuperação
   usa o callback PKCE `/auth/callback?flow=recovery`.
6. Para um banco vazio, criar manualmente o primeiro usuário Auth e sua
   linha `usuarios` como administrador ativo. Depois disso, somente o
   convite administrativo da aplicação pode provisionar contas.
7. Rodar o projeto:
   ```
   npm run dev
   ```
8. Abrir `http://localhost:3000` - deve redirecionar para `/login`.

Validacao local:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Os testes RLS usam `.env.test.local`, conforme `.env.test.example`, e só
rodam com `npm run test:integration` em homologação isolada.

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
