# Clinica Odontologica - MVP v1

Sistema de gestao para uma clinica odontologica real (agenda, pacientes,
prontuario, documentos, retornos, tarefas, pagamentos, orcamento e
controle de validade/esterilizacao).

> Status atual: **Sprint 0 concluida** (infraestrutura). Nenhuma
> funcionalidade do sistema foi implementada ainda. Ver `CLAUDE.md` para
> as regras do projeto e `docs/TODO.md` para o roadmap completo.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Supabase (Postgres + Auth + Storage + RLS)
- Deploy: Vercel

Justificativa completa em `docs/ARCHITECTURE.md`.

## Estrutura do projeto

```
app/            rotas Next.js (App Router)
components/     componentes de UI reutilizaveis (vazio na Sprint 0)
lib/supabase/   clientes Supabase (sem auth ainda)
server/         server actions / rotas de API (vazio na Sprint 0)
types/          tipos TypeScript compartilhados (vazio na Sprint 0)
supabase/       migrations e seed (vazios na Sprint 0)
docs/           documentacao viva do projeto
```

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
   valores reais:
   ```
   cp .env.local.example .env.local
   ```
4. Rodar o projeto:
   ```
   npm run dev
   ```
5. Abrir `http://localhost:3000` - deve aparecer a pagina de placeholder
   da Sprint 0.

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
