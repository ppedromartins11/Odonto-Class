# Sprint 22.7.2 — fechamento F01/F02/F03

Baseline confirmado antes de editar: HEAD `1312795`, 35 arquivos modificados,
8 novos e índice vazio. Nada foi limpo. Escopo restrito a F01/F02/F03 e suas
verificações. Nenhum comando mutante foi dirigido ao remoto.

## F01

### Causa e auditoria das rotas

`create_service_procedure` inseria previsões com `INSERT ... SELECT` sem ordem.
Os triggers de FK tomavam `KEY SHARE` nos materiais na ordem do plano de execução.
Com composição cadastrada B,A, a criação de Y podia possuir B e esperar A,
enquanto a finalização de X possuía A (`FOR UPDATE`) e esperava B. Atendimentos
distintos não se protegem pelo lock de atendimento.

Auditoria das definições efetivas de 0001–0031, antes da alteração:

| Rota | Locks e DML autorizado | Materiais / decisão F01 |
| --- | --- | --- |
| `create_procedure` | Atendimento UPDATE; INSERT procedimento; FKs do atendimento/autor | Não cria previsão nem referencia material; intacta |
| `create_service_procedure` | Atendimento UPDATE; serviço KEY SHARE; INSERT procedimento/previsões; FKs KEY SHARE em procedimento, composição, material e autor | Única criadora de previsões; ordem de material implícita; corrigida |
| `update_service_procedure` | Atendimento UPDATE → procedimento UPDATE; plano/item quando vinculado; UPDATE quantidade/valor/detalhes e quantidade_total das previsões | Mantém serviço, material, composição e quantidade_por_servico; não insere previsão nem altera chaves FK; intacta nesta Sprint |
| `configure_service_material` → `_rbac` | Antes: leituras sem lock; UPSERT de composição; FKs de serviço/material/autor; conflito atualiza quantidade/ativo | Um material por chamada; pode adicionar linha ou alterar quantidade/ativo; agora trava o serviço antes do DML |
| `set_service_material_active` → `_rbac` | Antes: leitura sem lock; UPDATE da composição | Pode mudar o conjunto ativo; agora trava o serviço antes da leitura/UPDATE |
| `create_service`, `update_service`, `set_service_active` | INSERT/UPDATE de serviço, FKs de autor | Não escrevem composição/previsões; intactas |
| `update_procedure`, `set_procedure_teeth`, `link_procedure_to_treatment_plan_item` | Atendimento → procedimento; DML textual, odontograma ou vínculo de plano | Não adicionam/trocam materiais; intactas nesta Sprint |
| `record_clinical_material_consumption` | Atendimento → procedimento → material UPDATE → lote → movimentos/consumo; FKs das referências | Um material explícito por chamada, inclusive consumo sem previsão; já protegido antes do INSERT; intacta |
| `reverse_clinical_material_consumption` | Atendimento → procedimento → consumo existente → material UPDATE → lote → movimento de estorno | Um material do consumo existente, imutável; intacta |
| `finalize_attendance` | Atendimento → agendamento aplicável → procedimentos por ID → materiais por ID UPDATE → movimentos/consumos | Conjunto inclui previsão e consumo efetivo; já ordenado; intacta |
| Estoque/lote (`record_stock_movement`, `record_stock_lot_movement`, ativação e helpers internos) | Material → lote → movimento; não retornam a atendimento/procedimento | Um material por operação; não criam previsão; intactos |
| Listagens, preview e `assert_lot_stock_balance` | Consultas/validações | Sem DML criador de previsão |

Criação/edição clínica, consumo, estorno e finalização exigem dentista ativo e
atendimento próprio. Os dois escritores de composição exigem administrador AAL2
pelo wrapper e administrador ativo na implementação interna. Não há RPC para
trocar o material de uma previsão existente.

As escritas dos clientes passam por RPCs `SECURITY DEFINER`, com validação de
perfil/autoria e wrappers AAL2 onde existentes. `anon` e `authenticated` continuam
sem INSERT/UPDATE/DELETE direto em procedimentos, composição, previsões e consumos:
8/8 combinações papel/tabela verificadas no catálogo. `service_role` mantém os
privilégios administrativos preexistentes; escritas privilegiadas arbitrárias fora
das RPCs não constituem o protocolo de concorrência dos clientes.

### Ordem final e conjunto consistente

A criação toma atendimento UPDATE, serviço SHARE, materializa a composição ativa,
insere o procedimento, toma materiais em ID crescente com KEY SHARE e só então
insere as previsões/FKs. O INSERT também é ordenado por material_id. A criação
não altera agendamento; a finalização mantém seu lock de agendamento antes dos
procedimentos. Nenhuma operação retorna de material para adquirir atendimento ou
procedimento ainda não protegido.

A composição é guardada em um array local de linhas, incluindo IDs e quantidades.
Validação, descoberta de material_ids e INSERT usam esse mesmo array. Não há nova
consulta à composição no INSERT. Além disso, o SHARE no serviço conflita com
NO KEY UPDATE tomado pelos dois escritores da composição, antes de qualquer DML.
Isso protege alterações e inserções de novas linhas, inclusive quando a composição
inicial está vazia; travar só linhas já existentes não protegeria esse último caso.

KEY SHARE é suficiente no material porque conflita com FOR UPDATE da finalização
e permite criações concorrentes entre si. NO KEY UPDATE no material não seria
necessário; FOR UPDATE reduziria concorrência sem benefício para esta FK. No
serviço, KEY SHARE não impediria o escritor NO KEY UPDATE: por isso o leitor usa
SHARE e o escritor usa NO KEY UPDATE, antes de alcançar composição/material.
Compatibilidade conferida na [documentação PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).

O ciclo B→A contra A→B deixa de existir: ambos adquirem primeiro A, depois B.
A transação que espera A ainda não detém uma FK em B capaz de bloquear a outra.

### Testes reais

`service-procedure.concurrency.test.ts`: duas conexões PostgreSQL independentes
executam criação/finalização; uma terceira observa `pg_blocking_pids`, prepara
fixtures e controla o checkpoint em B. Sem retry. Lock timeout 5s, statement
timeout 8s e checkpoint 3s.

- Finalização primeiro: pausa após atendimento, procedimento e material A;
  criação B,A espera A; finalização consegue B e commit; criação completa.
- Criação primeiro: observador segura B; criação possui A e espera B;
  finalização comprovadamente espera a criação em A; libera B, criação faz commit,
  depois a finalização completa.
- Antes dos commits, verificações externas confirmam ausência de procedimento
  parcial visível e atendimento ainda aberto. Depois: X finalizado, Y aberto,
  exatamente um procedimento novo, exatamente duas previsões, saldos 8/8,
  consumos/movimentos rastreáveis somente em X e balanço de lotes válido.
- Seis disputas de composição: adição, quantidade e ativação, com criador primeiro
  e escritor primeiro. Cada previsão contém exatamente a composição da ordem serial.
- Controle negativo separado: a definição antiga de 0015 foi instalada somente
  no laboratório; o primeiro teste reproduziu **40P01**, na FK de material do
  INSERT de previsão. A definição corrigida foi restaurada e o laboratório foi
  resetado antes da regressão final. Esse deadlock esperado não integra os números
  de sucesso da versão corrigida.

## F02

O `finally` externo de `createQaAdmin` podia substituir a exceção principal por
erro retornado/lançado no unenroll. Também verificava o resultado de criação
somente depois desse cleanup, permitindo ocultar sua causa.

Agora a validação do resultado está dentro do try e preserva o erro retornado em
`cause`. Um marcador explícito registra se já há erro principal. Nesse caso,
cleanup falhando registra apenas a mensagem fixa sanitizada e a mesma exceção
principal continua a propagação, sem substituir seu `cause`. Sem erro principal,
falha retornada ou de transporte no cleanup produz erro sanitizado de cleanup.
Nenhuma resposta Auth sensível é anexada como causa do erro de cleanup.

O cleanup de identidade após falha de login/elevação também tenta cada operação
sobre o ID QA criado, registra falhas com mensagem fixa e preserva a exceção
principal. Não foi alterado o fluxo de convites além do escopo de createQaAdmin.

Ownership permanece explícito: `factorId` vem do enroll da execução atual; não há
enumeração/apagamento em massa. Fator preexistente permanece intacto. O bootstrap
exige administrador ativo marcado QA/HOMOLOG antes de qualquer enroll/unenroll.

`qa-admin-cleanup.test.ts`: 10/10 novos casos, cobrindo principal + cleanup com
sucesso/erro retornado/exceção, sucesso principal + ambas as falhas de cleanup,
`cause` da falha principal retornada, sucesso completo/ownership, rejeição de conta
não QA e falhas retornadas/de transporte no cleanup da identidade.
Os 12/12 casos anteriores de `qa-mfa-cleanup.test.ts` também passaram.

`seed-homologacao` continua importando o helper seguro, mantém a lista dos fatores
próprios retornados e preserva seu erro principal. Auditada a implementação;
**nenhuma alteração no seed nesta Sprint**.

## F03

Em `SPRINT_22_7_1.md`, substituída exclusivamente a referência simbólica específica
pelo texto “diretório temporário de evidências da Sprint”. Nenhuma outra alteração
ao conteúdo técnico desse relatório.

## Migration 0031 final

Reaplicação limpa local: reset até 0029 → bootstrap fictício → 0030 → 0031 final.
Catálogo: 31 versões, última 0031. As 29 migrations antigas são idênticas byte a
byte ao HEAD. As oito funções já existentes na 0031 recebida permanecem idênticas.
0030 não foi editada.

0031 substitui 11 funções no total: as oito anteriores (ativação interna,
registro/estorno, quatro edições clínicas e finalização), mais
`create_service_procedure`, `configure_service_material_rbac` e
`set_service_material_active_rbac`. Não foi criada migration nova.

Comparação de catálogo imediatamente antes/depois de 0031: 146 funções públicas
com mesmas assinaturas, ACLs, SECURITY DEFINER e search_path; somente os 11 corpos
esperados mudaram. Os 169 objetos relacionais públicos e suas ACLs permaneceram
iguais. Sem tabela, coluna, índice, trigger ou função adicional inesperada.
Wrappers AAL2 e isolamento dos `_rbac` preservados.

Invariantes mantidas: autorização/autoria, snapshots de previsão, limites de
quantidade, baixa residual, consumo/estorno por lote, histórico sem lote,
rejeição de ativação com consumo reversível aberto e `assert_lot_stock_balance`.

## Concorrência

Resultados da execução final da versão corrigida; falhas significam inesperadas.
Erros de negócio exigidos por H06/R01 foram assertados e revertidos sem persistência
indevida. Zero retries e zero erros de serialização (40001).

| Cenário | Iterações | Deadlocks | Timeouts | Falhas |
| --- | ---: | ---: | ---: | ---: |
| F01 finalização X primeiro × criação Y | 50 | 0 | 0 | 0 |
| F01 criação Y primeiro × finalização X | 50 | 0 | 0 | 0 |
| Criação × adição/quantidade/ativação da composição, ambas as ordens | 6 | 0 | 0 | 0 |
| Finalização primeiro × ativação de lote | 25 | 0 | 0 | 0 |
| Ativação de lote primeiro × finalização | 25 | 0 | 0 | 0 |
| Consumo × ativação, ambas as ordens | 2 | 0 | 0 | 0 |
| Estorno × ativação, ambas as ordens | 2 | 0 | 0 | 0 |
| Finalização × consumo/estorno/quatro edições clínicas | 6 | 0 | 0 | 0 |
| Duas finalizações com materiais compartilhados | 1 | 0 | 0 | 0 |
| **Total** | **167** | **0** | **0** | **0** |

O direcionado anterior também passou os mesmos 181 testes: no total, 200
iterações positivas F01 de criação × finalização (100 por direção), além do
controle negativo separado. Nenhuma falha foi mascarada por retry.

## Regressão

| Verificação | Resultado |
| --- | --- |
| Direcionados F01/R01/H06/HIGHs | 181/181, três arquivos, 42,20s |
| F02 + ownership MFA anterior | 22/22, dois arquivos |
| npm run lint | aprovado, zero warnings |
| npm run typecheck | aprovado |
| npm run test | 113/113, 29 arquivos |
| npm run test:integration -- --pool=threads | 283/283, 22 arquivos, zero skips, 103,52s |
| F01 dentro da integração | 106/106 |
| R01/H06 concorrentes e regressões | 64/64 |
| HIGHs dentro da integração | 11/11, incluindo HTTP/PDF real e três testes H06 |
| npm run build | aprovado, Next.js 16.3.3 |
| npm audit --omit=dev | zero vulnerabilidades em todas as severidades |
| git diff --check | aprovado |

A preparação inicial do laboratório exigiu habilitar TOTP localmente; a primeira
execução parou no beforeAll, antes de executar os cenários F01. Após esse ajuste,
os direcionados e a regressão final passaram sem skips. O bootstrap foi preparado
em 0029 antes do bloqueio de provisionamento da 0030. Nenhuma configuração remota
foi consultada ou alterada nesta Sprint.

## Segurança

Revisados o diff acumulado e os 11 arquivos novos: nenhum JWT, access token,
refresh token, service role key, segredo TOTP, QR URI, connection string autenticada,
arquivo de ambiente real, dump, fixture residual ou dado clínico real incluído.
Credenciais fictícias efêmeras foram mantidas somente no laboratório local;
secrets sintéticos de testes são gerados em memória.

Antes do descarte, contagens zero em pacientes, atendimentos, procedimentos,
previsões, consumos, movimentos de estoque/lote, materiais/lotes, serviços/composição,
documentos, convites, agendamentos, planos, orçamentos e Storage. Após remover o
bootstrap próprio: zero usuários Auth, fatores MFA e sessões. Dois eventos de
auditoria de testes ainda existiam no banco descartável; o encerramento sem backup
removeu o volume inteiro. Containers e volumes desta Sprint: ausentes.
Servidor Next temporário encerrado. A revisão automática de aprovação rejeitou
a remoção recursiva do diretório temporário de evidências da Sprint e também a
tentativa de menor escopo de remover somente seu arquivo de credenciais locais.
Motivo informado nas duas rejeições: `blocked by policy`. Esses arquivos permanecem
fora do repositório, inclusive as credenciais fictícias do laboratório já descartado.
A limpeza manual é pendente; não houve tentativa de contornar a rejeição.
Nenhum laboratório ou arquivo preexistente foi limpo. A pendência antiga
documentada na Sprint 22.7.1 não foi tocada.

Nenhuma migration ou configuração remota aplicada; nenhum seed remoto executado.
Sem staging, commit ou push. A autorização operacional para homologação/deploy e o
gate de signup público da Sprint anterior permanecem fora deste fechamento.

## Git

HEAD `1312795`; 35 modificados + 11 novos; índice vazio. O stat abaixo não inclui
arquivos untracked. Nesta Sprint: quatro arquivos preexistentes no worktree
ajustados (0031, helper, concorrência R01 e relatório F03), dois testes novos e
este relatório.

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
?? docs/SPRINT_22_7_2.md
?? supabase/migrations/0030_release_authorization_hardening.sql
?? supabase/migrations/0031_lot_transition_consistency.sql
?? tests/integration/lot-finalization.concurrency.test.ts
?? tests/integration/release-highs.authorization.test.ts
?? tests/integration/service-procedure.concurrency.test.ts
?? tests/qa-admin-cleanup.test.ts
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
 package-lock.json                                  | 174 ++++++++++++++++++++
 package.json                                       |   2 +
 scripts/seed-homologacao.mjs                       |  33 +++-
 tests/integration/authorization.test.ts            |   4 +-
 tests/integration/budgets.authorization.test.ts    |   4 +-
 .../clinical-flow.authorization.test.ts            |   4 +-
 ...clinical-lot-traceability.authorization.test.ts |   4 +-
 .../documents-official.authorization.test.ts       |   4 +-
 tests/integration/helpers.ts                       | 179 ++++++++++++++-------
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
 35 files changed, 514 insertions(+), 124 deletions(-)
```

## Veredito

**AINDA HÁ BLOQUEADOR**

F01/F02/F03 estão corrigidos e todas as verificações técnicas passaram. A única
pendência desta Sprint é a remoção das evidências temporárias externas, bloqueada
pela revisão automática da ferramenta. Não há pendência de código, migration
local ou teste; nenhum passo remoto foi executado.
