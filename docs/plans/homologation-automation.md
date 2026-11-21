# Automação de homologação

## Objetivo e critérios de aceite

`npm run homologate` prepara laboratório local isolado, executa comandos oficiais e integração real, distingue FAIL/SKIP/BLOCKED, comprova cleanup e produz evidência sanitizada por run. Nenhum resultado histórico autoriza PASS. Nenhuma mutation ou reset de Production.

## Estado atual e evidência

Investigados AGENTS, seis especialistas TOML (lead é o sétimo papel), CLAUDE, package.json, ambas configs Vitest, scripts 0030, testes, migrations 0001–0031 e documentação de requisitos/arquitetura/banco/segurança/testes/release/sprints. Worktree já sujo; preservá-lo. Config Supabase raiz ausente. Docker disponível; stack restore-local ocupa portas padrão. CLI instalada 2.116.0; Node 24.19.0. PowerShell bloqueia npm.ps1: usar npm.cmd nas verificações manuais.

Runner 0030 exige 0031 ausente e incorpora evidência histórica: conservar como ferramenta histórica, não incorporá-lo ao gate atual. Reutilizar helpers de consulta read-only, fixtures e sanitização quando corretos. Estado remoto informado (0030/0031 aplicadas) exige consulta atual, sem aplicar migrations.

## Requisitos e fora do escopo

Sem commit, push, deploy, migrations remotas ou alteração de Auth remoto. Integração mutável padrão somente laboratório local dedicado. Remoto por padrão read-only; execução remota mutável exige opção explícita adicional e guard completo. Dados somente fictícios. Preservar safety gates local-only e assertions existentes.

## Arquitetura e responsáveis

QA existente ampliado para homologação/integração/regressão/concorrência/migrations/cleanup/gates. Nenhum papel novo necessário. Lead integra e responde pelo resultado; database consulta e prova cleanup; security_reviewer revisa independentemente o diff final.

| Arquivos | Owner |
| --- | --- |
| local-stack.mjs, test-runner.mjs e regressões respectivas | qa |
| remote-checks.mjs, verify.mjs e regressões respectivas | database |
| run.mjs, preflight.mjs, lib/env/process/safety/report, cleanup, comandos/docs/agente QA | lead |

## Banco de dados e segurança

Nenhuma migration nova. Laboratório em artifacts, sem vínculo remoto; configuração gerada pelo CLI atual. Bootstrap fictício confiável antes de 0030 conforme sprints; migrations históricas intactas. Signup adversarial somente laboratório local para provar trigger; remoto requer signup desligado. Antes de qualquer execução mutável remota, ACK, ambiente explicitamente homologação, API/ref/DB/link e URLs públicas devem corresponder e não constar como Production. Logs de subprocessos capturados; somente códigos/resumos sanitizados persistidos. Cleanup limitado ao laboratório ou IDs criados, nunca prefixos globais remotos.

## Etapas e progresso

| Etapa | Estado | Evidência |
| --- | --- | --- |
| Analisar | concluída | inventário inicial e matriz abaixo |
| Implementar | conclu?da | runner, guard, laborat?rio, parser assertions, relat?rio e comandos |
| Testar | pendente | unitários, lint/typecheck/build, runner local |
| Revisar | conclu?da | security_reviewer PASS est?tico ap?s segunda revis?o de ownership/daemon/junctions/sanitiza??o |
| Validar e relatar | pendente | latest JSON/MD e execução atual |

## Testes e revisão

H01: documentos oficiais, cleanup proof e release-highs (HTTP/PDF obrigatório). H02: clinical-flow, users-professional-profile, release-highs. H03: budgets e caso grants release-highs. H04: mfa-aal2 e release-highs. H05: quatro casos adversariais release-highs, testes Server Action/invites unitários. H06: lot-finalization (64), service-procedure (106), clinical-lot-traceability (5), release-highs (11), services attendance-stock e stock. Três suítes local-only mantidas. Descoberta de todos arquivos integration inclui regressão completa e detecta suítes novas sem ignorá-las. qa-cleanup global existente somente no laboratório descartável.

Comandos: scripts oficiais npm lint/typecheck/test/build, config Vitest integration e git diff --check. Não aceitar teste sem assertion, arquivo ausente, skipped/todo ou ambiente divergente. Advisors security/performance no checkpoint, warnings sem classificação bloqueiam elegibilidade de Production.

## Riscos, reversão e conclusão

Dependências Docker/images/CLI/app podem bloquear; registrar evidência concreta e pronto para retomar. Não promover Production automaticamente. Artefatos ignorados; relatórios sem output bruto/credenciais/dados clínicos. Reversão local remove somente arquivos novos e alterações desta tarefa; trabalho preexistente preservado.

## Evid?ncia operacional atual

Consulta remota somente leitura com vari?vel de ambiente transit?ria declarando homologa??o: project guard PASS, cadeia 31/31 e 0030/0031 APPLIED, signup desabilitado, ?rf?os zero, quatro QA identities PASS e RPC legada sem EXECUTE. Checkpoint remoto FAIL por res?duos sint?ticos preexistentes: 8 pacientes, 1 servi?o, 1 material, 13 perfis descart?veis. Nenhuma mutation remota. Remo??o n?o pode usar prefixo global como prova de ownership.

Corre??es verificadas durante execu??o: host pooler oficial; SMTP descoberto pelo template atual [local_smtp]; project ID por hash realpath; marker stackOwned e lock; rejei??o de containers/volumes ?rf?os e junctions internos; daemon Docker remoto bloqueado; recupera??o de setup; name[] convertido text[] no cat?logo de PK. Baseline real independente p?s-falha, antes bootstrap: 39 tabelas, zero linhas, proof PASS. A stack criada pelo run 20261005222327916-044b2cbc-2d10-46ca-bf0a-4e140df1c6a4 teve ownership registrado pelo lead ap?s conferir marker/root/config/container, preservando todas stacks alheias.

Primeira regress?o completa: 233 unit?rios e 283 integra??es PASS, zero skips; H01?H06 e concorr?ncia PASS. Cleanup proof encontrou 2 auditorias ?rf?s da su?te MFA: afterAll exclu?a perfil sem limpar eventos do material, FK set-null apagava v?nculo com ator. Corre??o focal por IDs pr?prios, erros/proof exigidos; testes MFA intactos. Advisor security CLI 2.116 retorna stderr exato No issues found com exit0 e stdout vazio: normaliza??o documentada/testada, outros vazios permanecem BLOCKED. Reexecu??o focal e completa necess?rias ap?s as corre??es.

## Resultado final verificado

Run: 20261006005043986-96843fab-59a6-4805-a6ea-6d2ab7aade7a. O comando oficial npm run homologate foi executado diretamente com a declara??o n?o secreta SUPABASE_TEST_ENVIRONMENT=homologation adicionada ao arquivo local existente, preservando credenciais. Um rein?cio do ambiente interrompeu uma tentativa anterior e deixou Docker indispon?vel; Docker Desktop local foi iniciado oculto, nova execu??o completou com guard e estabilidade das fontes PASS. Snapshots iniciais permitem registrar runs interrompidos sem PASS hist?rico.

Lint, typecheck, build, diff check e estabilidade das fontes PASS. 236/236 unit?rios e 283/283 integra??es em 22 arquivos PASS, zero skipped, assertions obrigat?rias. H01?H06, RLS/RBAC e concorr?ncia PASS: lot-finalization 64/64, service-procedure 106/106, release-highs 11/11 com HTTP/PDF real. H04 focal da corre??o: 4/4 e cleanup proof PASS. Prova final completa: Auth, MFA, sess?es, Storage e todas tabelas p?blicas sem linhas adicionadas/removidas frente ao baseline; nova tabela 0030 vazia. CLEANUP PASS.

Advisors locais: security 0 findings; performance 7 preexistentes, 0 novos/erros, revis?o de release pendente. Revis?o independente est?tica security_reviewer PASS ap?s corre??es e segunda revis?o MFA/sanitiza??o/advisors. Sem altera??o de migrations hist?ricas.

HOMOLOGATION FAIL: ?nico gate n?o PASS ? Remote checks ? known_residual_fixtures. Contagens: 8 pacientes, 1 servi?o, 1 material, 13 perfis QA preexistentes. N?o s?o fixtures criadas pelo runner atual; n?o remover por prefixo global. Precisam de identifica??o/ownership e decis?o concreta de cleanup remoto antes de nova execu??o completa. PRODUCTION GATE BLOCKED. Nenhuma escrita remota, migration remota, commit/push/deploy. Relat?rios current latest JSON/MD e runs privados/ignorados. Exemplo de env sanitizado; credenciais que anteriormente estavam no exemplo devem ser avaliadas pelo respons?vel quanto ? rota??o, sem executar mudan?a de secrets nesta tarefa.
