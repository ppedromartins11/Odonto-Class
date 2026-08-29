# Seguranca e LGPD

## Matriz do modulo Estoque (Sprint 12)

| Acao | Administrador ativo | Recepcao ativa | Dentista ativo | Inativo/sem perfil |
|---|---:|---:|---:|---:|
| Consultar materiais | Sim | Sim | Sim | Nao |
| Criar/editar/ativar material | Sim | Nao | Nao | Nao |
| Entrada | Sim | Sim | Nao | Nao |
| Saida | Sim | Sim | Sim, motivo obrigatorio | Nao |
| Ajuste | Sim, motivo obrigatorio | Nao | Nao | Nao |
| Historico | Completo | Completo | Somente proprio | Nao |
| Resumo no Dashboard | Sim | Sim | Nao | Nao |

`materiais_estoque` e `movimentacoes_estoque` negam DML direto. As RPCs validam sessao, usuario ativo, perfil, limites de quantidade e saldo. A movimentacao usa bloqueio de linha e e imutavel; a auditoria guarda somente IDs, tipo e saldos, sem motivo ou conteudo clinico.

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
| Uploads | Bucket privado `arquivos-paciente`; PDF/JPEG/PNG ate 10 MiB, URL assinada temporaria de cinco minutos e autorizacao server-side. |
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

Ainda nao implementado: MFA (PAV-20, gate de go-live). O modulo de arquivos
ja limita PDF/JPEG/PNG a 10 MiB, valida MIME, extensao e magic bytes e usa
bucket privado com URL assinada temporaria.

## Headers e configuracoes externas

- A aplicacao envia `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` e `Permissions-Policy` por `next.config.ts`.
- CSP com nonce, HSTS, rate limiting, MFA/AAL2, SMTP, Redirect URLs, dominio,
  backup e restauracao dependem de configuracao e validacao externas. Eles nao
  foram considerados configurados apenas por existirem no codigo.
- Falha de escrita de auditoria e registrada sem dados sensiveis. A decisao de
  bloquear ou nao uma operacao de identidade quando a auditoria estiver
  indisponivel permanece um requisito operacional a confirmar.

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

## Matriz do modulo Financeiro basico (Sprint 11)

| Acao | Administrador ativo | Recepcao ativa | Dentista ativo | Inativo/sem perfil |
|---|---:|---:|---:|---:|
| Consultar pagamentos | Todos | Todos os operacionais | Somente dos proprios atendimentos | Nao |
| Registrar pagamento | Sim | Sim | Nao | Nao |
| Cancelar/estornar pagamento pago | Sim | Nao | Nao | Nao |
| Ver indicadores agregados | Sim | Nao | Nao | Nao |

`pagamentos` aceita somente `SELECT` sob RLS; `INSERT`, `UPDATE` e `DELETE`
diretos para clientes autenticados sao revogados. As RPCs validam usuario
ativo, perfil, paciente, vinculo com atendimento/orcamento e a regra de no
maximo uma referencia. Auditoria armazena somente IDs, forma e transicao de
status, nunca observacao administrativa.

## Matriz do modulo Orcamentos (Sprint 10)

| Acao | Administrador ativo | Recepcao ativa | Dentista ativo | Inativo/sem perfil |
|---|---:|---:|---:|---:|
| Listar/consultar | Todos | Todos | Somente os proprios | Nao |
| Criar rascunho | Sim | Sim | Somente com ele como responsavel | Nao |
| Editar rascunho/itens | Sim | Sim | Somente os proprios | Nao |
| Enviar/aprovar/rejeitar/convertir | Sim | Sim | Somente os proprios, conforme transicao | Nao |
| Gerar PDF | Sim | Sim | Somente os proprios | Nao |

As tabelas aceitam apenas `SELECT` sob RLS. RPCs com `SECURITY DEFINER`
possuem `search_path = ''`, validam usuario ativo, perfil, profissional e
transicao antes de qualquer gravacao. O PDF e gerado sob rota autenticada,
sem Storage, URL publica ou conteudo sensivel na auditoria.

## Matriz do modulo Pacientes (Sprint 2)

| Recurso/acao | Administrador ativo | Dentista ativo + profissional ativo | Recepcao ativa | Inativo/sem perfil |
|---|---:|---:|---:|---:|
| Listar/buscar dados administrativos | Sim | Sim | Sim | Nao |
| Criar/editar dados administrativos | Sim | Sim | Sim | Nao |
| Ler/alterar alertas clinicos atuais | Nao | Sim | Nao | Nao |
| Inativar/reativar paciente | Sim | Nao | Nao | Nao |
| Excluir fisicamente pela aplicacao | Nao | Nao | Nao | Nao |

Administrador nao recebe autorizacao clinica por inferencia. O modelo atual
tem um unico perfil e inativa `profissionais` quando o usuario deixa de ser
dentista; representar administrador + dentista e uma pendencia futura, caso
a clinica confirme a necessidade.

As escritas passam pelas RPCs `create_patient`, `update_patient`,
`update_patient_clinical_alerts` e `set_patient_active`, com autorizacao e
auditoria na mesma transacao. Escrita direta e `DELETE` estao revogados.
A UI nao consulta `paciente_alertas_clinicos` para administrador/recepcao,
e a RLS repete o bloqueio contra chamadas diretas.

## Matriz do bloco Agenda / Atendimento / Procedimentos

| Recurso/acao | Administrador ativo | Dentista ativo + profissional ativo | Recepcao ativa | Inativo/sem perfil |
|---|---:|---:|---:|---:|
| Ver agenda geral | Sim | Nao | Sim | Nao |
| Ver propria agenda | Sim | Sim | Sim | Nao |
| Criar/editar/remarcar/confirmar/cancelar/falta | Sim | Nao | Sim | Nao |
| Iniciar atendimento agendado proprio | Nao | Sim | Nao | Nao |
| Criar atendimento direto proprio | Nao | Sim | Nao | Nao |
| Ler/alterar evolucao e procedimentos proprios | Nao | Sim | Nao | Nao |
| Ler clinico de outro dentista | Nao | Nao | Nao | Nao |
| Escrita direta ou DELETE | Nao | Nao | Nao | Nao |

Agenda e dado administrativo. Evolucao e procedimentos sao segregados em
tabelas com RLS propria; consultas de administrador/recepcao retornam zero
linhas, portanto o conteudo nao chega a HTML, payload ou CSS oculto. As RPCs
clinicas derivam o profissional de `auth.uid()` e nao aceitam profissional
arbitrario. Finalizacao, auditoria e mudanca para `agendamento.atendido`
ocorrem na mesma transacao.

Auditoria nunca armazena evolucao, descricao/material/detalhes do procedimento
ou observacao administrativa. Apenas IDs, transicoes, horarios e nomes de
campos necessarios para rastreabilidade operacional.
