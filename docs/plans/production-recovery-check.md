# Production recovery check

## Retomada autorizada — 2026-10-19

Este checkpoint atualiza os estados históricos abaixo. O usuário autorizou
DATABASE BACKUP → INTEGRITY → RESTORE LOCAL; Storage e auditoria somente após
esses gates; Vercel/Preview/QA/release somente após RECOVERY PASS. Limite máximo:
PRODUCTION GATE ELIGIBLE, sem migrations/deploy Production, commit/push ou DR.

- Topologia aceita: SESSION_POOLER:5432; TLS cliente→endpoint verify-full PASS;
  backend pg_stat_ssl=false explicado, sem novo bloqueio por esse campo.
- Destino privado preservado: production-20261018T154548Z no backup root fora
  de OneDrive. Nenhum dump existente na revisão independente inicial.
- Production continua read-only; nenhuma informação clínica vai ao workspace,
  logs ou relatório. Auth permanece REDUCED AUTH BACKUP; exclusões exatas e
  projeções serão registradas antes do primeiro dump, sem tokens/MFA/sessões.
- Responsáveis: lead integra e mantém este plano; database_backup escreve o
  executor de dump/helper ACL/testes; restore_rehearsal escreve executor/testes
  de restore; recovery_audit faz revisão independente sem executar backup.
- Ajustes locais em revisão: gate TLS cliente separado de backend; manifest
  allowlist; Auth JSON/token projections; prevenção de secrets em configs e
  tabelas auxiliares; restore sem senha em arquivo e com catálogo gerenciado.
- Docker estava parado nesta retomada. Inicialização local oculta solicitada;
  disponibilidade real e acesso serão comprovados antes do único probe de
  revalidação que precede o dump.
- Validações dos owners: 12 testes de executor e 4 de restore PASS; syntax e
  diff check PASS. Revisão operacional/integridade/restaurabilidade pendentes.
- Nenhum dump, restore, Storage ou Vercel executado nesta retomada até aqui.
- Revisão independente dos executores liberou execução estática (16 testes
  focados e syntax PASS); Docker Server 29.7.2 pronto após início local.
- Execução autorizada `--backup`: revalidação imediata PASS para Production,
  QA excluída, SESSION_POOLER, TLS cliente verify-full, servidor 17.6/cliente
  17.11, sequência exata 0001–0031 e pendentes 0032/0033, ACLs reais. BitLocker
  informado transparentemente como CHECKPOINT_PASS, sem evidência contrária.
- Antes do primeiro dump, SOURCE_SECRET_SURFACE_REVIEW_REQUIRED interrompeu
  o fluxo. Nenhum roles/schema/data criado. Investigação necessária somente
  read-only/count-only para distinguir configurações de roles potencialmente
  secretas e foreign objects, inclusive possível alcance excessivo do guard
  comparado ao comportamento oficial. Não há aprovação operacional de backup.
- Diagnóstico count-only confirmou unsafeRoleConfigCount=1 exclusivamente
  database-specific/setrole=0, unsafeExported=0 e foreignObjectCount=0. Nenhum
  valor de configuração foi exibido ou persistido. O dump oficial roles-only
  não exporta esse setting. Guard corrigido para setdatabase=0 + role existente
  não pg_*, mantendo filtros de segredo/config desconhecida e acrescentando
  CR/LF. Fontes oficiais e estratégia de dump inalteradas. Re-review
  independente PASS; 16 testes PASS, 1 SQL local opt-in SKIP transparente.
  Retomada do backup autorizada pelo lead, com revalidação interna imediata.
- Owner comprovou também teste SQL real em PostgreSQL17 local descartável,
  network=none: 9 cenários fictícios de configurações, suite total 17 PASS e
  nenhum SKIP. Revalidação imediata da retomada passou; guards de configs e
  dados auxiliares passaram. `auth-reduction.json` foi documentado antes do
  dump: 25 tabelas Auth excluídas, 6 colunas temporárias esvaziadas, projeções
  de users/identities com JSON allowlist. Dump em andamento; PASS operacional
  ainda não declarado.
- DATABASE BACKUP PASS e DATABASE INTEGRITY PASS: executor terminou exit 0;
  roles.sql/schema.sql/data.sql não vazios, stderr vazio, estrutura preliminar
  e SHA-256 verificados. Manifest privado database-backup-manifest.json criado.
  Contagens do mesmo snapshot: usuários/perfis 24/24, pacientes 21, agenda 16,
  atendimentos 11, orçamentos 1, pagamentos 1, Storage objects 10. Snapshot
  encerrado via ROLLBACK. Nenhuma mutation Production/QA/DR.
- Restore local descartável liberado ao owner após gates de banco e revisão.
  Storage owner prepara tooling somente local; nenhuma operação/credencial
  Storage será acessada antes de DATABASE RESTORE PASS. Auditor independente
  revisa metadados/hashes sem expor conteúdo clínico.
- Auditor independente confirmou hashes/tamanhos/ACLs privadas dos três SQLs,
  allowlist do manifest, target, TLS/session, pin de imagem, migrations e Auth
  reduzido: DB audit PASS. Git diff --check PASS; trabalho prévio preservado.
- Primeiro restore parou no preflight APP_AUTH_TRIGGER_BASELINE_DRIFT antes
  de criar qualquer recurso. Owner confirmou diferença textual única:
  pg_get_triggerdef omitiu public. nos dois templates baseline. Normalização
  permanece fechada nesses templates e requer suplemento privado
  auth-trigger-bindings.json com binding public/nomes/zeroargs, hashes iguais
  ao catálogo salvo e SHA-256 do catálogo. Checagem adicional somente de
  metadados read-only autorizada; sem redump, sem alterar os três SQLs.
- Suplemento real Auth bindings PASS, auditado independentemente: dois triggers
  únicos, definições/estado e função pública sem argumentos correspondem ao
  snapshot, hashes de função e SHA-256 do catálogo conferem. Nenhum redump ou
  alteração remota. Restore preserva Cmd/config/PGDATA da imagem confiável e
  impõe somente logging/datadir locais seguros; re-review PASS, 5 testes PASS.
  Retry local autorizado com isolamento/cleanup obrigatórios; gate operacional
  de restore e Storage ainda pendente.
- Primeira execução local efetiva terminou MANAGED_SCHEMA_VERSION_MISMATCH
  após bootstrap migration-only de Auth/Storage e antes de roles/schema/data.
  CLEANUP PASS; tentativa 01011836-8019-4058-8a0e-424cd7bada70 preservada no
  manifesto privado. Nenhum dado do backup carregado, nenhuma conexão remota
  no rehearsal. Paridade não foi relaxada. Diagnóstico local --bootstrap-only
  com verdict NOT_RUN e expected/observed versões sanitizadas revisado PASS;
  owner buscará bootstrap/imagem oficial que corresponda exatamente ao snapshot.
  RECOVERY gate permanece bloqueado até restore+Storage reais PASS.

## Retomada autorizada — 2026-10-18

Este checkpoint substitui pendências históricas abaixo sem descartar evidências.

- BitLocker C: PASS comprovado pelo usuário (100%, XTS-AES 128, Protection On).
  Não repetir a investigação sem evidência contraditória.
- Credencial nesta sessão: PRESENT; validação estrutural em memória confirmou
  Production e excluiu QA. Nenhum componente da URI foi registrado.
- Destino antigo C:\OdontoClass-Backups permanece intacto. Novo destino proposto:
  C:\Users\ppedr\AppData\Local\OdontoClass-Backups. ACL do pai observada no
  sandbox sem permissão ampla de alteração; confirmação no contexto do usuário
  e criação privada dependem da permissão de filesystem fora do workspace.
- Lead escreve somente este plano e tooling novo de proteção. AGENT B revisa
  dump/Auth read-only; C valida Docker/executor e posteriormente executa backup;
  F revisa independentemente. D (restore) e E (Storage) somente após pré-gates.
- Estratégia escolhida: REDUCED AUTH BACKUP, conforme runbook atual:
  auth.users/auth.identities preservados. RECOVERY GAP: sessões, refresh tokens,
  MFA/TOTP/WebAuthn e desafios não serão recuperados; exige reautenticação e
  novo enrollment. Não declarar recuperação Auth completa.
- Official CLI fixado em v2.116.0, commit
  997a1e69a4a83466964ed874d3a604c88a7b3866. Reproduzir scripts e transformações
  oficiais em PostgreSQL 17 com CA read-only e verify-full; proibição de URI
  em argv/env Docker persistido/arquivos. Auth reduzido é delta documentado.
- Scripts/rehearsal devem preservar triggers app-owned de auth.users do baseline
  aprovado até 0031; nunca incluir 0032/0033 pendentes.
- Estado atual: RECOVERY BLOCKED até ACL criada/auditada, probe container,
  dumps íntegros, restore descartável, bytes Storage e auditoria independente.
  Gates Vercel/release continuam bloqueados. Nenhuma mutação Production/QA/DR.
- Novo run criado: `C:\Users\ppedr\AppData\Local\OdontoClass-Backups\production-20261018T154548Z`.
  Script revisado `scripts/recovery-secure-root.ps1`, execução exit 0: parent,
  root/run ACL, fora de OneDrive PASS. Herança desativada no root/run e
  subdiretórios; somente usuário nominal, SYSTEM e Administrators FullControl.
  Pai tem adicional de sandbox somente ReadAndExecute/Synchronize. Ancestrais
  sem reparse points; destino antigo inalterado. Evidência privada em
  `manifests/local-protection.json`.
- Docker client/server 29.7.2 PASS. Imagem oficial postgres:17-bookworm,
  cliente 17.11 e digest
  `sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826`.
- F confirmou independentemente as ACLs reais do root/run, quatro subdiretórios
  e manifest privado, com leitura escalada: PASS. Script PowerShell sem erros
  de parsing; diff focado sem whitespace errors. O executor ainda não conectou.
- D prepara rehearsal DB-only único com imagem Supabase PostgreSQL 17.6
  existente, rede interna, sem portas publicadas, sem serviços Auth/email/app,
  PGDATA tmpfs e destruição explícita após validação; nenhum container existente
  será reutilizado ou resetado. Execução depende dos dumps e revisão F.
- B/C/F identificaram que a allowlist de tabelas Auth não basta: auth.users
  contém tokens temporários. A estratégia REDUCED exige projeção explícita
  dessas colunas para vazio/NULL conforme constraints, sem imprimir linhas;
  preservar hashes de senha autorizados. Dados, catálogo e contagens usarão
  snapshot exportado read-only comum. Nenhum probe/dump executado nesta fase.

### Bloqueio novo após probe — checkpoint final desta retomada

- Após revisão independente do executor, C executou probe PostgreSQL 17
  read-only com credencial via stdin, CA read-only e PGSSLMODE=verify-full.
  A resposta JSON foi recebida, mas falhou na validação combinada de banco,
  versão esperada 17.6, pg_stat_ssl e transaction_read_only:
  `READONLY_PROBE: PRODUCTION_PROBE_MISMATCH`.
- Houve duas tentativas read-only: a primeira classificação de erro foi
  excessivamente genérica; a segunda identificou o código combinado. Nenhum
  campo divergente foi impresso/persistido, e a resposta em memória se perdeu
  com o processo. Esta limitação do diagnóstico foi reconhecida; não há base
  para afirmar mudança de versão, falha TLS ou comportamento do pooler.
- F determinou STOP de novas conexões conforme instrução do usuário. A hipótese
  de pg_stat_ssl medir o trecho backend após pooler não foi comprovada e não
  autoriza relaxar a verificação. Nenhum dump ou restore executado.
- Correção local preparada: diagnóstico limitado a databaseExpected,
  serverExpected, versão numérica, serverTlsFlag e readOnlyExpected. Nenhum
  host, URI, senha, query string ou linha clínica será exibido. A projeção
  reduzida Auth também exclui colunas geradas (como confirmed_at) do COPY.
- ACTION_REQUIRED: PRODUCTION_PROBE_DIVERGENCE. Próxima ação única: autorizar
  um probe diagnóstico read-only do executor revisado, sem backup automático,
  para identificar a condição divergente e reconciliar o gate. Comando:
  `node scripts/recovery-database-backup.mjs --run C:\Users\ppedr\AppData\Local\OdontoClass-Backups\production-20261018T154548Z --probe-only`.
- Banco/restore/Storage não executados; Vercel e release não acessados.
  RECOVERY GATE BLOCKED; PRODUCTION GATE BLOCKED. Production/QA/DR mutations
  NONE; commit/push/deploy NONE. Evidências históricas abaixo são preservadas,
  sem substituir este checkpoint atual.
- Validações finais: 3 testes focados PASS; syntax check dos executores PASS;
  restore --plan PASS sem criar recursos; git diff --check global exit 0.
  Git status preservou mudanças preexistentes. F revisou a correção de
  diagnóstico/projeção gerada: CLEAR apenas estático, sem autorizar nova leitura.
- Tooling restore é preparação não comprovada: bootstrap gerenciado ainda não
  validado; revisão F deixou pendentes paridade de RLS/policies/grants dos schemas
  gerenciados, metadata de colunas geradas Auth e stdin explícito do psql.
  Resolver/revisar antes de qualquer rehearsal com dados do backup.
- Recursos: nenhum container/rede/volume de rehearsal criado; containers
  efêmeros de inspeção/probe --rm encerrados. Não existe dump neste novo run.

## Objetivo e critérios de aceite

Executar os dez gates solicitados em 2026-10-17, com Production somente leitura.
Backup principal pelo CLI oficial Supabase; integridade de banco e Storage,
restore somente em ambiente local descartável e relatório sanitizado.

## Estado atual e evidência

- Worktree já tinha alterações extensas; preservá-las integralmente.
- Target Production validado como `sqouddqzpmkofenyufuj`; QA
  `zxvpyxvhymuibaxgxetf` excluída da URI, sem imprimir host ou credencial.
- Variáveis de conexão e CA presentes; arquivos CA presentes.
- Migrations locais 0001–0033; remoto comprovado exatamente 0001–0031.
- Probe autorizado fora do sandbox: banco postgres, PostgreSQL 17.6,
  TLS autorizado, CA e hostname verificados, transação somente leitura.
- CLI oficial 2.116.0 e Docker Server 29.7.2 confirmados fora do sandbox.
- CLI Supabase e Docker disponíveis; psql/pg_dump não estão no PATH.
- Docker inicialmente negado pelo sandbox; verificar com escalonamento quando necessário.

## Requisitos e fora do escopo

Nenhuma mutation em Production ou DR, nenhuma migration remota, nenhum commit
ou push. Não persistir credenciais, URI, tokens ou URLs assinadas. Parar em
erro TLS ou migration inesperada. Não acessar Vercel antes de recovery PASS.
O backup privado solicitado é exceção explícita para armazenamento local;
não utilizar esses dados no desenvolvimento ou em QA.

## Arquitetura e responsáveis

- Lead: procedimento, único responsável por escrita deste plano e artefatos.
- security_reviewer: revisão independente read-only do procedimento e evidências.
- Usar pg instalado apenas para probes SELECT em transação read-only, com
  CA explícita, verificação de hostname e rejectUnauthorized=true.
- Usar supabase db dump para roles/schema/data; verificar TLS também no
  caminho de execução do CLI e no container, sem redução da validação.

## Arquivos impactados

| Grupo | Mudança | Owner |
| --- | --- | --- |
| Este plano | Evidência sanitizada e progresso | Lead |
| .gitignore | Adicionar /.backups/ somente se chegar ao gate de backup | Lead |
| .backups/production-TIMESTAMP/ | Dumps privados e manifests | Lead |

## Banco de dados e segurança

- Nenhuma migration nova ou alteração de autorização.
- Conexão precisa confirmar banco postgres, TLS autorizado e histórico exato 0001–0031.
- Queries de inventário e contagens não retornam linhas clínicas.
- Dumps e manifests com paths Storage nunca aparecem em saída de terminal.
- Antes de qualquer dump: confirmar destino não versionado e ignorado,
  restringir ACL ao usuário atual e SYSTEM, confirmar exclusão de senhas de roles.
- Comprovar criptografia em repouso antes de persistir dados. Como o workspace
  está sob OneDrive, usar EFS para impedir sincronização de SQL legível ou um
  destino local protegido fora da sincronização; não presumir que Gitignore protege dados.
- Comprovar cobertura de auth.users/auth.identities e storage.buckets/objects;
  excluir sessões, refresh tokens, fatores/desafios MFA, WebAuthn e tokens
  temporários. Hashes de senha permitidos somente no backup privado protegido,
  conforme runbook, nunca na saída ou manifests.
- Conferir contagens em snapshot coerente e conciliar alterações concorrentes;
  não declarar corrupção ou PASS a partir de snapshots incompatíveis.
- Restore local sem serviços da aplicação/Auth/email e sem saída remota.
- Comparar tabelas, funções, triggers, RLS, policies e grants preservando ACL.
- Storage: downloads autenticados apenas com credencial existente autorizada;
  se exigir nova credencial, ACTION_REQUIRED: STORAGE_BACKUP_CREDENTIAL.

## Etapas e progresso

| Etapa | Estado | Evidência |
| --- | --- | --- |
| Target | PASS | Validação estrutural da URI em memória; QA excluída |
| Conectividade/TLS | PASS | PostgreSQL 17.6, banco postgres, stream TLS autorizado |
| Migration state | PASS | Versões exatas 0001–0031; pendentes locais 0032/0033 |
| Backup banco | Bloqueado antes de gravar dados | Criptografia local pendente e executor CLI não encaminha configuração TLS/CA |
| Integridade banco | Não executada | Não existem dumps desta execução |
| Restore local | NOT POSSIBLE no checkpoint atual | Depende de backup aprovado |
| Storage/integridade | Não executada | Depende de backup banco PASS |
| Revisão independente | Concluída para o plano; evidência de backup pendente | security_reviewer: proteção local, cobertura e integridade exigidas antes do PASS |
| Recovery gate / relatório | BLOCKED | Proteção local e transporte TLS CLI pendentes; Vercel não acessada |

## Testes e revisão

Validações operacionais focadas; não executar testes de integração remota,
homologação ou aplicação sem os gates exigidos. Conferir diff local e manifests
sem imprimir conteúdo de dumps ou dados pessoais.

Evidências adicionais: `supabase db dump --role-only --dry-run`, capturado só
em memória, retornou exit 0 e confirmou `--no-role-passwords`. O script gerado
não inclui referência explícita a PGSSLMODE/CA. Revisão independente do código
oficial da versão 2.116.0 confirmou que legacyToDumpEnv encaminha somente
PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE; legacyStreamPgDump usa esse ambiente
e binds vazios. A camada Docker encaminha só opts.env ao container. Portanto,
não executar dump sem resolver a propagação de verify-full e da CA.
Nenhum dump foi iniciado. `.backups/` está vazio, ACL sem herança com duas
regras (usuário atual e SYSTEM); destino ignorado e não versionado.
EFS não é suportado nesse diretório; criptografia do volume não confirmada.
Antes da próxima execução, definir SUPABASE_TELEMETRY_DISABLED=1 e
DO_NOT_TRACK=1 somente no processo filho, conforme opt-out oficial. A revisão
do código não encontrou evidência de credenciais em telemetria: parâmetros
string de comandos legacy são redigidos. Nunca habilitar logs debug.
`git diff --check -- .gitignore docs/plans/production-recovery-check.md` passou.

## Riscos, reversão e conclusão

Falha TLS, histórico inesperado ou backup incompleto bloqueiam recuperação.
Não remover backups ou alterar ambientes para contornar bloqueios.
Atualizar este plano com resultados reais e o próximo passo permitido.

Próximo passo: obter destino local criptografado fora de sincronização (pergunta
enviada ao usuário), comprovar TLS no executor oficial e então retomar fase 4.
Não é falha TLS: probe TLS passou; não houve erro TLS observado no dry-run.
