# Sprint 22.7.1 — R01/R02

Baseline: HEAD `1312795`, 35 modificados, 5 novos; nenhuma limpeza,
staging, commit, push ou alteração remota autorizada. 0001–0029 intactas.

## R01 — análise anterior à alteração SQL

Ordem observada em 0029/0031 original:

- Finalização: atendimento; leitura de controle de lote sem lock; agendamento;
  materiais sem lote em ordem de ID; movimentação e consumo automáticos.
- Ativação (`set_stock_lot_control` → `_rbac`): material; leitura de consumos e
  atendimento sem lock; criação de lote. Não deve adquirir atendimento.
- Consumo: procedimento → atendimento → material → lote → movimentação → consumo.
- Estorno: consumo → procedimento → atendimento → material → lote → movimentação.
- Estoque avulso: material → lote (quando aplicável) → movimentação.
- Edições clínicas de procedimento também tomam procedimento → atendimento.
  Inserts automáticos tomam KEY SHARE nas referências: não basta considerar
  apenas FOR UPDATE explícito para avaliar ciclos.

Ordem escolhida: atendimento → procedimento → consumo existente → materiais por
ID crescente → lote → novas movimentações/consumos. O agendamento da finalização
é validado antes de materiais. A transição começa em material e nunca retorna a
atendimento/procedimento. As edições clínicas que alcançam atendimento recebem
o mesmo primeiro lock, antes do lock de procedimento; regras de negócio e grants
permanecem iguais. Isso é parte da prevenção de ciclos da finalização de R01.

Referência de compatibilidade dos locks:
[PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html).

## Gate operacional

**DESABILITAR SIGNUP PÚBLICO** continua obrigatório antes da homologação/deploy.
H05 não está fechado operacionalmente; nenhuma configuração remota é alterada.

## R01 — implementação final em 0031

- `finalize_attendance` trava atendimento, agendamento quando existente,
  procedimentos em ordem de ID e todos os materiais previstos ou efetivamente
  consumidos, em ordem de material_id. A seleção dos locks não filtra controle
  por lote. Só a instrução seguinte consulta novamente a flag e valida consumo.
- O preflight e a baixa automática residual permanecem; o consumo manual abate
  a previsão. Materiais controlados exigem consumo efetivo com lote. Estado
  legado com consumo ativo sem lote é rejeitado mesmo com agregado igual a lotes.
- `record_clinical_material_consumption`, `reverse_clinical_material_consumption`,
  `update_procedure`, `set_procedure_teeth`, `update_service_procedure` e
  `link_procedure_to_treatment_plan_item` tomam atendimento antes de procedimento.
  Estorno toma o consumo existente depois desses dois locks. Leituras iniciais de
  identidade apenas localizam o pai; as validações existentes rodam sob os locks.
  Nenhuma dessas RPCs permite mudar atendimento_id de um procedimento existente.
- Essas quatro edições de procedimento foram alinhadas exclusivamente porque
  poderiam manter procedimento travado enquanto aguardam o atendimento que a
  finalização já possui. Nenhuma outra regra de negócio foi modificada.
- A ativação continua material → lote, sem adquirir locks de atendimento ou
  procedimento. AAL2, grants e isolamento da implementação interna preservados.
- H06 permanece: consumo aberto sem lote impede ativar; estorno anterior permite;
  histórico finalizado não impede; consumo/estorno com lote conserva balanço;
  estorno legado sem lote após ativação falha antes da movimentação.

## R02 — ownership e cleanup

Antes, o ID só retornava depois de challenge/verify/assurance; uma falha impedia
o cleanup externo de conhecer o fator. Agora o ID retornado pelo enroll entra
imediatamente no escopo protegido. Falha tenta unenroll somente desse ID e
propaga o erro original (erros retornados pela API são preservados em `cause`).
Falha do cleanup produz somente mensagem fixa sanitizada, sem serializar Auth.
No sucesso, o retorno transfere a responsabilidade ao chamador.

O seed importa o mesmo helper; não duplica a elevação. Seu cleanup final tenta
todos os fatores próprios devolvidos com sucesso e preserva eventual erro
principal. Nenhum list/delete em massa de fatores foi introduzido. Bootstrap
continua exigindo perfil administrativo ativo com marcador QA/HOMOLOG; os outros
chamadores usam identidades QA da própria suíte/seed.

`tests/qa-mfa-cleanup.test.ts`: 12 cenários — erros retornados e de rede em cada
etapa, sucesso e cleanup normal, fator preexistente preservado, cleanup retornando
erro ou lançando exceção, enroll com ID sem secret, assurance AAL1 e enroll sem ID.
Secrets sintéticos dos mocks são gerados em memória, nunca persistidos.

## R03 — somente leitura e procedimento manual

Consulta remota confirmou duas contas Auth sem perfil, ambas com marcador QA.
Identificação técnica foi usada apenas em memória para as consultas seletivas.
Não há vínculos nas 67 colunas FK públicas para Auth/usuarios verificadas,
objetos Storage por owner, auditoria por entidade ou fatores MFA. Existem duas
sessões Auth; portanto não se afirma ausência absoluta de vínculos.

Marcadores e datas são compatíveis com fixtures de recepção das suítes de usuários
e planos de tratamento. Origem provável: cleanup anterior removeu o perfil e
interrompeu antes da remoção Auth. Isso é inferência, não prova de autoria.

Procedimento manual separado (não executado e sem DELETE automático nesta Sprint):

1. Identificar cada candidato pelo ID técnico em ambiente administrativo privado;
   conferir novamente marcador QA, ausência de perfil e origem da execução.
2. Reconsultar referências públicas, Storage, auditoria, fatores e sessões.
   Qualquer vínculo clínico/administrativo exige interromper o procedimento.
3. Após autorização específica, revogar somente as sessões desses candidatos e
   remover individualmente somente as duas identidades confirmadas via Auth Admin.
4. Verificar ausência dos IDs selecionados e preservação das demais contas.
   Não publicar emails, IDs ou dados de sessão no relatório.

Remoto verificado: última migration 0029, signup habilitado, confirmação de email
exigida. Nenhuma mutation remota foi executada, nem mesmo cleanup QA.

## Concorrência e execução

`lot-finalization.concurrency.test.ts` usa duas conexões PostgreSQL independentes
para as RPCs e uma terceira somente como observador/gestor de fixtures locais.
`pg_blocking_pids` comprova a espera, em vez de inferir concorrência por tempo.
Limites: lock_timeout 5s, statement_timeout 8s, checkpoint 3s; nenhum retry.

- 25 iterações: finalizar primeiro, ativação espera commit; saldo inicial 10,
  previsão 2, resultado finalizado/8 e lote inicial 8; consumo e movimento ligados.
- 25 iterações: ativar primeiro, finalização espera e reavalia; rejeita com
  `LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING`; atendimento aberto/10/lotes 10,
  sem baixa ou consumo indevido.
- Seis disputas adicionais contra consumo, estorno e quatro edições clínicas.
- Uma disputa de finalizações com dois materiais compartilhados em ordens de
  cadastro opostas, comprovando saldos e consumos após serialização por ID.
- Três regressões: consumo integral, residual e legado controlado sem lote.

Durante desenvolvimento, corrigidos cleanup da fixture (alertas antes de paciente)
e dois checkpoints do teste (role da leitura FOR UPDATE e tipo smallint[] do
odontograma). Não houve deadlock escondido por retry. Resíduos da execução que
falhou no cleanup foram removidos somente no laboratório desta Sprint.

## Migration 0031 — resumo completo

Oito funções substituídas: ativação interna de lote, registro e estorno de consumo,
quatro edições clínicas de procedimento e finalização. Preserva H06, wrapper AAL2,
assinaturas, grants existentes, auditoria e baixa residual; adiciona ordem comum de
locks, bloqueio de todos os materiais antes da decisão e rejeição de rastreabilidade
legada sem lote. Reafirma revoke da implementação interna. Nenhuma tabela, coluna,
lote histórico ou correção automática de dados adicionada. Transação begin/commit.

Aplicação final comprovada via CLI **local**: reset descartável até 0029,
bootstrap QA, migration up com 0030 e 0031 final. Catálogo: 31 versões, última 0031.
Não foi criada 0032. A 0030 permanece como recebida; 0001–0029 comparadas byte a
byte com HEAD, 29/29 intactas.

## Regressão final

| Verificação | Resultado |
| --- | --- |
| npm run lint | aprovado, zero warnings ESLint |
| npm run typecheck | aprovado |
| npm run test | 103/103, 28 arquivos, incluindo 12/12 R02 |
| npm run test:integration -- --pool=threads | 173/173, 21 arquivos, zero skips |
| R01 | 60/60 dentro da integração |
| HIGHs | 11/11 dentro da integração, incluindo HTTP/PDF real |
| H06 | três testes HIGH cobrem as sete regressões solicitadas |
| npm run build | aprovado, Next.js 16.3.3 |
| npm audit --omit=dev | zero vulnerabilidades |
| git diff --check | aprovado |
| SQL lint local | zero erros; três avisos em duas funções financeiras preexistentes |

Integração final: 76,70 segundos, sobre aplicação limpa da migration final.
Concorrência final: 50 iterações principais (25 por ordem) + sete disputas
adicionais; zero 40P01, lock timeouts, 40001 ou esperas indefinidas. Sem retry.
As outras três verificações R01 cobrem integral, residual e legado; invariantes
A/B/C/D verificadas por status, saldos, consumos e encadeamento de movimentos.

Avisos SQL fora do escopo, preservados: variável v_numero sombreada e não usada
em create_financial_receivable; expressão volátil em get_payment_summary STABLE.

## Segurança e encerramento

- Nenhum JWT, access token, service role, TOTP secret, QR URI, URI autenticada,
  dump, dado clínico real ou arquivo temporário incluído no diff/arquivos novos.
  Configuração secreta do laboratório foi mantida fora do repositório.
- Testes/Auth/Storage mutantes executados somente no Supabase novo em loopback.
  Consultas remotas foram SELECT sob transação READ ONLY e GET de settings.
- Antes do descarte: zero pacientes, atendimentos, procedimentos, consumos,
  movimentos, materiais, lotes, serviços, documentos, convites e objetos Storage.
  Após remover somente o bootstrap próprio: zero usuários Auth, fatores e sessões.
  Restaram dois eventos de auditoria de testes no banco descartável; o laboratório
  foi então encerrado com --no-backup, removendo também esses eventos e o volume.
- Servidor Next temporário encerrado. Containers/volumes desta Sprint ausentes.
  A revisão automática rejeitou tanto a remoção recursiva da pasta temporária
  quanto a remoção individual do arquivo de ambiente, com motivo apenas
  `blocked by policy`. O diretório temporário de evidências da Sprint permanece fora do repositório,
  inclusive a configuração do laboratório já descartado. Limpeza manual pendente;
  não houve tentativa de contornar o bloqueio. Nada dessa pasta entra no diff.
- Nenhum laboratório ou arquivo preexistente foi limpo. Nenhum staging, commit
  ou push. Remoto permanece em 0029, sem aplicação de 0030/0031 ou alteração de
  configuração. Contas R03 preservadas.

## Veredito

**PRONTO PARA NOVA REVISÃO READ-ONLY**

Este veredito é para revisão do código. Homologação/deploy continuam dependentes
do gate DESABILITAR SIGNUP PÚBLICO e da autorização de aplicação remota.
H05 permanece aberto operacionalmente. Há também a limpeza manual da pasta local
externa descrita acima, bloqueada pela revisão automática da ferramenta.

## Git final

HEAD `1312795`; 35 modificados + 8 novos. Nesta etapa foram alterados três
arquivos existentes da Sprint 22.7 (0031, helper e seed) e criados três arquivos
(relatório, concorrência R01 e testes R02). O stat Git não inclui untracked.

`git status --short`

```text
 M .env.test.example
 M app/(app)/agenda/actions.ts
 M app/(app)/tratamentos/actions.ts
 M app/(app)/usuarios/actions.test.ts
 M app/(app)/usuarios/actions.ts
 M app/(app)/validade/actions.ts
 M app/api/documentos/[id]/route.ts
 M docs/CHANGELOG.md
 M docs/DATABASE.md
 M docs/DECISIONS.md
 M docs/DEPLOYMENT.md
 M docs/SECURITY.md
 M docs/TESTING.md
 M lib/clinical/material-consumption.test.ts
 M lib/clinical/material-consumption.ts
 M package-lock.json
 M package.json
 M scripts/seed-homologacao.mjs
 M tests/integration/authorization.test.ts
 M tests/integration/budgets.authorization.test.ts
 M tests/integration/clinical-flow.authorization.test.ts
 M tests/integration/clinical-lot-traceability.authorization.test.ts
 M tests/integration/documents-official.authorization.test.ts
 M tests/integration/helpers.ts
 M tests/integration/mfa-aal2.authorization.test.ts
 M tests/integration/odontogram.authorization.test.ts
 M tests/integration/operational.authorization.test.ts
 M tests/integration/patients.authorization.test.ts
 M tests/integration/payments.authorization.test.ts
 M tests/integration/receivables.authorization.test.ts
 M tests/integration/services.attendance-stock.authorization.test.ts
 M tests/integration/stock.authorization.test.ts
 M tests/integration/treatment-plans.authorization.test.ts
 M tests/integration/users-professional-profile.authorization.test.ts
 M tests/integration/validity-sterilization.authorization.test.ts
?? app/api/documentos/[id]/route.test.ts
?? docs/SPRINT_22_7.md
?? docs/SPRINT_22_7_1.md
?? supabase/migrations/0030_release_authorization_hardening.sql
?? supabase/migrations/0031_lot_transition_consistency.sql
?? tests/integration/lot-finalization.concurrency.test.ts
?? tests/integration/release-highs.authorization.test.ts
?? tests/qa-mfa-cleanup.test.ts
```

`git diff --stat`

```text
 .env.test.example                                  |   8 +-
 app/(app)/agenda/actions.ts                        |   4 +-
 app/(app)/tratamentos/actions.ts                   |   3 +-
 app/(app)/usuarios/actions.test.ts                 |  31 +++-
 app/(app)/usuarios/actions.ts                      |  41 +++--
 app/(app)/validade/actions.ts                      |   4 +-
 app/api/documentos/[id]/route.ts                   |  15 +-
 docs/CHANGELOG.md                                  |  12 ++
 docs/DATABASE.md                                   |  12 ++
 docs/DECISIONS.md                                  |  14 ++
 docs/DEPLOYMENT.md                                 |  10 ++
 docs/SECURITY.md                                   |  18 +++
 docs/TESTING.md                                    |   9 ++
 lib/clinical/material-consumption.test.ts          |   1 +
 lib/clinical/material-consumption.ts               |   4 +
 package-lock.json                                  | 174 +++++++++++++++++++++
 package.json                                       |   2 +
 scripts/seed-homologacao.mjs                       |  33 +++-
 tests/integration/authorization.test.ts            |   4 +-
 tests/integration/budgets.authorization.test.ts    |   4 +-
 .../clinical-flow.authorization.test.ts            |   4 +-
 ...clinical-lot-traceability.authorization.test.ts |   4 +-
 .../documents-official.authorization.test.ts       |   4 +-
 tests/integration/helpers.ts                       | 160 ++++++++++++-------
 tests/integration/mfa-aal2.authorization.test.ts   |   4 +-
 tests/integration/odontogram.authorization.test.ts |   4 +-
 .../integration/operational.authorization.test.ts  |   4 +-
 tests/integration/patients.authorization.test.ts   |   4 +-
 tests/integration/payments.authorization.test.ts   |   4 +-
 .../integration/receivables.authorization.test.ts  |   4 +-
 ...services.attendance-stock.authorization.test.ts |   4 +-
 tests/integration/stock.authorization.test.ts      |   4 +-
 .../treatment-plans.authorization.test.ts          |   4 +-
 ...sers-professional-profile.authorization.test.ts |   4 +-
 .../validity-sterilization.authorization.test.ts   |   4 +-
 35 files changed, 495 insertions(+), 124 deletions(-)
```
