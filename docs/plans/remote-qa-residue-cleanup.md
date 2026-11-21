# Inventário e cleanup remoto QA

## Objetivo e critérios de aceite

Comprovar origem dos resíduos remotos, mapear dependências e produzir dry run sanitizado. Executar cleanup somente se todos os gates condicionais do pedido forem comprovados; caso contrário, entregar ownership BLOCKED e cleanup NOT EXECUTED com evidência por ID. Classificar individualmente os sete advisors de performance.

## Estado atual e evidência

Worktree contém alterações preexistentes, preservadas. O relatório anterior registrou oito pacientes, um serviço, um material e **treze** perfis descartáveis. Esse último número estava subcontado: o checkpoint excluía todos os administradores QA ativos, inclusive um descartável. O inventário atual encontrou **quatorze** perfis descartáveis e quatro fixtures permanentes preservadas. As migrations históricas não foram modificadas.

## Requisitos e fora do escopo

Prefixo QA isolado não prova ownership. Não alterar registros ambíguos, fixtures atuais, produção, policies, grants, Auth settings ou migrations. Sem commit, push, deploy ou integração remota mutável por hábito.

## Arquitetura, responsáveis e arquivos

Lead escreveu `scripts/homologacao/inventory-remote.mjs`, a correção de `remote-checks.mjs`, teste, comando npm e documentação de uso. Database analisou schema/dependências; QA rastreou origem e escreveu [review dos sete WARN](performance-advisors-review.md); security reviewer revisou independentemente. Todos os especialistas trabalharam somente leitura. Relatórios sanitizados ficam em `artifacts/homologacao`, ignorados pelo Git. Nenhuma rotina de exclusão foi implementada porque as pré-condições condicionais falharam.

## Banco de dados e segurança

Inventário remoto executado em `BEGIN READ ONLY` e `REPEATABLE READ`; catálogo remoto tem 165 FKs e 39 triggers não internos nas superfícies inspecionadas. Metadados mínimos foram gravados em artefato ignorado, sem conteúdo clínico, emails, credenciais ou paths privados. Auth aparece por contagem de subtipos. Escrita remota dependeria de prova independente do alvo QA, ownership determinístico de cada dependente, fechamento relacional e dry run consistente. Prefixo ou parentesco FK não bastam. Sem bypass de RLS/FK e sem DML remoto.

## Etapas e progresso

| Etapa | Responsável | Estado | Evidência |
| --- | --- | --- | --- |
| Inventariar alvo e dependências | Lead/database | concluída | `artifacts/homologacao/remote-inventory/latest.md/json`, snapshot read-only |
| Rastrear e classificar ownership | Lead/QA | concluída; gate BLOCKED | 23 raízes confirmadas, 1 provável; 53 dependentes/auditorias sem prova independente |
| Produzir dry run e classificar advisors | Lead/QA | concluída | relatório por ID e revisão dos sete WARN |
| Revisar segurança independentemente | security_reviewer | concluída | PASS inventário/correção de contagem; cleanup BLOCKED |
| Executar cleanup condicional e proof | Lead | bloqueada | zero DML remoto; pré-condições falharam |
| Homologação integral nova | Lead | bloqueada | só após cleanup e proof PASS |
| Validar e relatar | Lead | concluída | testes e qualidade local; relatório final |

## Resultado do dry run remoto

O conjunto de **24 raízes candidatas** contém 8 `pacientes`, 1 `servicos`, 1 `materiais_estoque` e 14 `usuarios`. O último inclui o administrador `QA_RC_ADMIN_…` que a contagem antiga excluía indevidamente. Quatro fixtures atuais configuradas foram protegidas, fora do conjunto candidato. `NON_QA = 0` refere-se **somente ao conjunto candidato inventariado**, não a todo o banco. A busca por perfil usa `nome ~ '^QA_'`: um perfil renomeado sem esse prefixo não entraria nessa contagem.

Das 24 raízes, 23 têm origem confirmada pelo par Auth reservado + UUID/nome/papel da suíte ou pelo marcador exclusivo `QA_ODO_<tipo>_<uuid>` e `created_by` do administrador QA comprovado. O perfil `usuarios.id = 414dae79-0fe7-499a-9016-f6fea7451334` foi renomeado pela suíte `QA_USR`; seu nome atual perdeu o UUID que permitiria pareá-lo diretamente à identidade Auth. É `OWNERSHIP_PROBABLE`, não deletável apenas pelo email reservado. A auditoria disponível mostra ativações/desativações posteriores por outro ator, não o evento de criação desse perfil.

O fechamento de FKs achou 7 profissionais, 8 atendimentos, 8 procedimentos, 2 movimentações de estoque, 1 composição de serviço, 1 snapshot de material e 1 consumo clínico. As 14 contas Auth têm 14 identities, 9 sessions, 10 refresh tokens, 1 fator MFA, 10 AMR claims e 1 challenge. Há 25 eventos de auditoria ligados às entidades. Os 28 filhos públicos e 25 eventos são `OWNERSHIP_UNKNOWN` no dry run: ligação e autoria operacional não comprovam sozinhas origem exclusiva; a auditoria é polimórfica, sem FK para `entidade_id`. O [relatório por ID](../../artifacts/homologacao/remote-inventory/latest.md) lista o motivo de bloqueio por registro. Storage apresentou zero objetos ligados por owner/path de identidade e zero arquivos/PDF ligados aos oito pacientes.

Totais: `SAFE_TO_DELETE_CONFIRMED_QA = 0`, `CONFIRMED_QA_ORIGIN = 23`, `BLOCKED_UNKNOWN_OWNERSHIP = 54`, `NON_QA = 0` no escopo candidato. `OWNERSHIP = BLOCKED`; `CLEANUP = NOT EXECUTED`. A soma 54 compreende o perfil provável e os 53 filhos/auditorias sem comprovação independente.

O projeto consultado está vinculado às URLs API/DB e identificado pelo ambiente como homologação, mas o inventário independente de projetos Supabase o nomeia `clinica` e há outro projeto `odonto-class-dr-test`. Não há mapeamento positivo e revisado entre esses projetos e Production, e `SUPABASE_PRODUCTION_PROJECT_REFS` está vazia. O guard atual basta para consulta read-only, mas **não comprova exclusão inequívoca de Production para escrita**. O security reviewer confirmou esse bloqueio. Uma repetição read-only do checkpoint, após corrigir a exclusão das fixtures, confirmou 8/1/1/14 resíduos, 31/31 migrations, órfãos zero e signup desabilitado; o gate remoto permanece `FAIL` somente pelos resíduos.

Pré-condições read-only confirmadas: migrations 0030/0031 aplicadas entre 31 versões, órfãos Auth→perfil e perfil→Auth iguais a zero, signup desabilitado, materiais controlados com zero divergências entre saldo agregado e soma dos lotes. São estado **antes de cleanup**, não proof posterior. O snapshot tem SHA-256 no JSON para comparação, mas não constitui autorização de exclusão nem solução de concorrência.

Ordem técnica candidata, **não executável neste estado**: preservar/avaliar auditorias e Auth; tratar Storage exato se houver; consumos, movimentações e snapshots; procedimentos e atendimentos; composição de serviço e catálogo; profissionais, pacientes e perfis; finalmente Auth Admin API. Cada etapa dependeria de revalidação transacional dos IDs e de prova de propriedade de todos os filhos. Não há lista de DELETE aprovada.

## Testes e revisão

Seis regressões focadas cobrem bloqueio de `--execute`, guard inválido, identidade forjada, administrador descartável e classificação de origem. `npm test` passou com 242/242; lint, typecheck e `git diff --check` passaram. A integração remota de suites não foi executada. O reviewer independente aprovou o inventário somente leitura e a correção da contagem; bloqueou a exclusão pelo conjunto incompleto e pela falta de prova de ambiente. Varredura automatizada do JSON sanitizado encontrou zero endereços de email, URLs Postgres, formatos JWT e URLs de Storage assinadas.

## Riscos, reversão e conclusão

Para desbloquear, é necessária prova verificável da identidade do ambiente e de Production e, por ID, da origem do perfil renomeado, dos 28 filhos e dos 25 eventos de auditoria, ou uma solução segura para preservar eventos sem criar referência incoerente. Só depois cabe revisar um algoritmo de cleanup com rechecagem, locks, transação SQL, Auth/Storage segregados e proof pós-exclusão. O banco permanece intacto; nenhum `npm run homologate` integral novo foi executado, porque o pedido o condicionou ao cleanup/proof PASS.

## Continuação em 06/10/2026

A [classificação independente do ambiente](environment-classification.md) encontrou vínculo **positivo** do ref alvo com uma variável de Vercel **Production**; o gate não está apenas sem prova, ele está conectado à configuração de Production. O [fechamento de ownership](ownership-closure-review.md) confirmou a cadeia de 27 dos 28 dependentes. O profissional ligado ao perfil renomeado permanece bloqueado. O perfil também segue apenas provável: Auth e metadata atual corroboram a suíte, porém metadata editável e ausência de manifesto/evento de criação impedem prova determinística desse ID. Os 25 eventos de auditoria devem ser preservados pela política de retenção. Os números anteriores de 53 dependentes/auditorias desconhecidos foram refinados pelos novos relatórios; `SAFE_TO_DELETE_CONFIRMED_QA` continua zero e nenhum cleanup foi executado.
