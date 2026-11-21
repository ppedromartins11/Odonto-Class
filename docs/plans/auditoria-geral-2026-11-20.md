# Auditoria geral e refatoração controlada — 20/11/2026

## Objetivo e critérios de aceite

Inventariar o checkout atual, corrigir falhas locais comprovadas de baixo risco,
preservar funcionalidades e trabalho preexistente, e relatar evidências e limites.
Validação: lint, typecheck, unitários, build e `git diff --check` antes/depois.

## Estado atual e evidência

- Git inicial: cinco arquivos rastreados modificados em `financeiro/` e muitos
  arquivos não rastreados, inclusive migrations 0032–0034, testes, scripts,
  planos e artefatos de recuperação. São preexistentes e ficam preservados.
- Baseline local: lint e typecheck passaram; Vitest passou com 341 casos e 1
  ignorado em 58 arquivos; build Next.js 16.3.8 passou; `git diff --check`
  passou, com avisos de normalização de linha nos cinco arquivos financeiros.
- O build carregou `.env.local`; não prova comportamento do Supabase nem
  isolamento de ambiente. Nenhuma integração remota será executada aqui.

## Requisitos e limites

- Preservar Auth SSR, MFA/AAL2, RLS, dados clínicos, financeiro, Storage,
  migrations históricas e trabalho local. Sem operação remota, commit ou deploy.
- Não excluir arquivos não rastreados do usuário nem caches/artefatos que possam
  conter evidência operacional ou backup. Arquivos em `public/` e `supabase/`
  ficam protegidos.
- Corrigir apenas problemas comprovados durante esta auditoria e manter
  recomendações maiores como pendências.

## Arquitetura e responsáveis

| Arquivo ou grupo | Mudança prevista | Owner |
| --- | --- | --- |
| `ReceivableForm.tsx` | Distinguir falha da busca de ausência de referências, retry, bloqueio de envio ambíguo | Principal |
| `financeiro/actions.ts` | Validar vínculo e confirmação explícita de recebível sem origem | Principal |
| Testes financeiros focados | Regressão da ação com dados fictícios | Principal |
| `.gitignore` | Consolidar duplicatas e ignorar resíduos gerados comprovados | Principal |
| `tatus --short` | Remover captura antiga de `git diff --stat` sem referência | Principal |
| `package.json`, `package-lock.json` | Atualizar apenas Next e transitivas vulneráveis após audit | Principal |
| Este plano | Registrar decisões, evidências e conclusão | Principal |

O `qa` mede baseline e inventaria artefatos/dependências sem escrita. O
`security_reviewer` faz auditoria independente de Auth, SQL, Storage, financeiro
e revisa o diff sensível após estabilização. Um único owner escreve cada arquivo.

## Banco de dados e segurança

Nenhuma migration nova nem alteração de schema/RLS/grants/RPC. A Server Action
valida entrada e confirmação; a RPC `create_financial_receivable` mantém a
autorização e a validação do vínculo. A 0031 continua bloqueada sem comprovação
dos gates; estados remotos de 0030–0034 não serão inferidos de documentos.

## Etapas e progresso

| Etapa | Estado | Evidência |
| --- | --- | --- |
| Analisar | concluída | Inventário por grupos, docs, código, Git e baseline local |
| Implementar localmente | concluída | Recebíveis, ignore, regressão e remoção comprovada |
| Testar | concluída localmente | 10 testes focados; lint, typecheck, 345 testes e build passaram |
| Revisar independentemente | concluída localmente | PASS do diff financeiro; FAIL da integridade do PDF de orçamento existente |
| Validar e relatar | concluída localmente | `git diff --check` PASS e escopo revisado |

## Resultado da auditoria e inventário

- Runtime: rotas e componentes em `app/`, `components/`, `lib/`, `proxy.ts`,
  `public/brand/`; `server/.gitkeep` é marcador, não runtime.
- Desenvolvimento/testes: configs Next/TypeScript/ESLint/PostCSS/Vitest,
  `package*.json`, `tests/`, testes próximos ao código, scripts de QA e CI.
- Banco/release: `supabase/migrations/`, `supabase/functions/` se presentes,
  scripts de homologação/recuperação e documentação técnica. Migrations 0032–0034
  são arquivos locais não rastreados, não uma prova de aplicação remota.
- Gerados/recriáveis: `.next/`, `tsconfig.tsbuildinfo`, caches e `scripts/tmp/`.
  Foram ignorados quando apropriado, sem exclusão de dados locais.
- Evidências/backup a reter: `.dr/`, `artifacts/homologacao/`,
  `h05-logs.jsonl` e demais arquivos não rastreados do usuário.
- Obsoleto comprovado: `tatus --short`, captura antiga de Git sem uso em
  runtime/build/testes; removido. Nenhum pacote foi removido: todos os pacotes
  declarados têm uso direto ou de configuração/CI.
- `npm audit --omit=dev` inicial encontrou 1 alerta crítico (`next@16.3.8`)
  e 2 altos (`sharp@0.35.4`, `source-map-js@1.2.1`). Atualização pontual para
  Next 16.4.6, sharp 0.35.5 e source-map-js 1.2.4; audit de produção agora
  informa zero vulnerabilidades. O lockfile foi atualizado, sem remover pacote.
- A auditoria completa detectou mais 13 alertas em ferramentas de
  desenvolvimento (9 moderados e 4 altos). `npm audit fix --no-audit` atualizou
  transitivas dentro das faixas existentes, incluindo Vitest/Vite, e acrescentou
  cinco dependências transitivas necessárias, sem removê-las. `npm audit` final
  retornou zero vulnerabilidades; revisão independente aprovou o escopo do diff.

O teste de tipagem teve uma falha intermediária em `pagination.test.ts`, arquivo
não rastreado editado concorrentemente depois do baseline. O arquivo não foi
alterado nesta auditoria; a execução final de typecheck, lint e testes passou.

Achado pendente da revisão independente: a migration local 0033 permite que
`register_budget_pdf_version` receba SHA/tamanho declarados pelo caller e
verifique somente presença/path no Storage. O teste de integração existente
espera sucesso com hash fictício. Isso viola a integridade declarada do PDF de
orçamento; requer migration aditiva, atestação dos bytes e integração em banco
fictício isolado. O gate de segurança geral fica FAIL para este ponto, embora
o diff financeiro tenha recebido PASS estático.

## Testes e revisão

- Baseline antes das edições: lint PASS, typecheck PASS, 341 testes PASS / 1
  skipped em 58 arquivos, build PASS, `git diff --check` PASS.
- Após edições: 10 testes focados PASS; lint PASS, typecheck PASS, 345 testes
  PASS / 1 skipped em 59 arquivos, build PASS com 35 páginas estáticas;
  `git diff --check` PASS. Avisos LF/CRLF são de normalização do Git.
- Após o upgrade: `npm ci --no-audit` PASS; lint, typecheck, 345 testes PASS /
  1 skipped, build Next 16.4.6 PASS e `npm audit` completo com zero alertas.
- `npm run test:integration`, navegador autenticado e homologação não executados:
  o checkout carrega `.env.local` e não há comprovação de isolamento do backend
  para estas ações. O build não valida RLS/RPC em PostgreSQL.

## Riscos, reversão e conclusão

Reversão local: remover somente as linhas e arquivos desta auditoria, sem tocar
nas alterações iniciais. Integração PostgreSQL, QA e Production exigem gate
separado. A auditoria está concluída apenas após diff e revisão final.
