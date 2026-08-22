# Seguranca e LGPD

Este documento e uma analise tecnica, nao um parecer juridico. Pontos
marcados como "requer validacao profissional" precisam de confirmacao
com advogado/contador especializado em regulacao de saude antes de
serem tratados como definitivos.

## Principios adotados

| Tema | Abordagem |
|---|---|
| Autenticacao | Supabase Auth (e-mail + senha), SSR/PKCE; MFA obrigatorio para administrador antes do go-live (PAV-20). |
| Autorizacao | Sempre verificada no backend/banco (RLS) - nunca apenas ocultando UI. |
| RBAC | Perfil gravado em `usuarios.perfil`; policies de RLS leem `auth.uid()`. |
| Isolamento de dados | RLS em toda tabela com dado clinico/pessoal. |
| Secrets | Apenas em variaveis de ambiente; nunca commitados. `.env.local` no `.gitignore`. |
| Sessoes | Gerenciadas pelo Supabase Auth (JWT + refresh token); logout explicito. |
| Logs | Nunca registrar dado clinico sensivel em logs de aplicacao/erro. |
| Auditoria | Tabela `auditoria` append-only criada na migration `0002`. Eventos de identidade/acesso da Sprint 1.5 estao fechados em PAV-18; eventos clinicos entram antes do modulo correspondente. |
| Uploads | Buckets privados no Supabase Storage; acesso via URL assinada/temporaria. Tamanho/tipos permitidos ainda em definicao (PAV-19). |
| Backups | Backups automaticos do Postgres gerenciado; teste de restauracao obrigatorio antes de producao (RNF-07). |
| Retencao | Prontuario odontologico normalmente tem prazo minimo de retencao legal - **prazo exato requer validacao profissional**. |
| Exclusao | Exclusao logica por padrao; exclusao fisica de prontuario esta desabilitada por decisao (PAV-17) e **requer validacao profissional** antes de qualquer mudanca. |
| Exposicao de dados sensiveis | Minimizacao de campos coletados (PAV-09); segregacao entre dado administrativo e clinico onde possivel. |

## Regra transversal

Nenhum ambiente de desenvolvimento ou teste deve conter dados reais de
paciente (RN-09). Dados ficticios apenas.

## Base implementada nas Sprints 1 e 1.5

Implementado:
- Autenticacao via Supabase Auth (e-mail + senha), sessao via cookies
  (`@supabase/ssr`), com refresh automatico no `proxy.ts`.
- Recuperacao de senha (RF-01): fluxo de e-mail com link de redefinicao
  (`app/esqueci-senha`, `app/auth/*`, `app/redefinir-senha`). Requer as Redirect URLs
  correspondente configurada no painel do Supabase - ver
  `docs/DEPLOYMENT.md`.
- Logout real (menu do usuario no Header).
- RLS em `usuarios` e `profissionais` desde a criacao das tabelas (ver
  `docs/DATABASE.md`).
- Protecao de rota em DUAS camadas independentes, nunca so uma:
  1. `proxy.ts` - bloqueia antes de qualquer pagina
     renderizar, quem nao tem sessao valida.
  2. `requireUser()`/`requireAdmin()` (`lib/auth/session.ts`) - checagem
     de novo dentro de cada pagina/layout protegido, incluindo o perfil
     (RBAC) para a pagina de Usuarios.
- Criacao de usuario via convite administrativo (Supabase Admin API,
  chave de servico isolada em `lib/supabase/admin.ts`, importada com
  `server-only` para nunca vazar para o bundle do cliente). A checagem
  de "e admin?" acontece no server action ANTES de chamar a API
  privilegiada - nunca dependemos so da tela estar escondida do menu.

Ainda nao implementado: MFA (PAV-20, gate de go-live) e limites de
upload (PAV-19 - nao aplicavel ainda, sem modulo de arquivos).

## Hardening da Sprint 1.5

- `proxy.ts` renova a sessao e replica cookies **e headers** retornados
  pelo `setAll` do `@supabase/ssr`, inclusive `Cache-Control: private,
  no-store`, evitando cache compartilhado de resposta autenticada.
- Conta inativa, conta Auth sem perfil e erro de consulta sao estados
  distintos e fail-closed. O login encerra a sessao nesses estados para
  evitar o ciclo `/login` <-> `/dashboard`.
- Convite/recuperacao usam callback SSR PKCE e contexto temporario em
  cookie HttpOnly assinado; conhecer apenas a URL de `/redefinir-senha`
  nao autoriza troca de senha.
- Desativacao combina RLS (`is_active_user()`) e suspensao no Auth. A
  primeira barreira bloqueia os dados mesmo enquanto um JWT antigo ainda
  nao expirou.
- Funcoes `SECURITY DEFINER` usam `search_path = ''`, referencias
  qualificadas e privilegio minimo de `EXECUTE`.
- `auditoria` nao aceita `INSERT`, `UPDATE` ou `DELETE` de usuario
  autenticado. Escrita ocorre por trigger/RPC controlada ou helper
  server-only; senha, token e conteudo clinico nunca entram em `dados`.

## Matriz vigente antes dos modulos clinicos

| Recurso/acao | Administrador ativo | Dentista ativo | Recepcao ativa | Inativo/sem perfil |
|---|---:|---:|---:|---:|
| Ler o proprio perfil | Sim | Sim | Sim | Apenas o proprio perfil, para detectar bloqueio; sem dado clinico |
| Listar todos os usuarios | Sim | Nao | Nao | Nao |
| Convidar/alterar/desativar usuario | Sim | Nao | Nao | Nao |
| Listar profissionais | Sim | Sim | Sim | Nao |
| Consultar auditoria | Sim | Nao | Nao | Nao |

Todo recurso de Sprint 2 em diante nasce negado e recebe matriz por
modulo/acao/campo antes de sua migration. A recepcao tera somente
financeiro operacional; indicadores gerenciais serao exclusivos do
administrador, conforme PAV-21.
