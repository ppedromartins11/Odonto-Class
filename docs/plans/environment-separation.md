# Separação definitiva de ambientes — 07/10/2026

## Alvos e regra de escrita

| Ambiente | Ref oficial | Estado confirmado | Escrita de homologação |
| --- | --- | --- | --- |
| Production | `sqouddqzpmkofenyufuj` | ACTIVE_HEALTHY, us-west-2 | Proibida |
| QA | `zxvpyxvhymuibaxgxetf` | ACTIVE_HEALTHY, us-west-2 | Permitida após guard |
| DR | `qprzxkolbbnqfopamfhj` | INACTIVE, us-west-2 | Proibida |

O guard exige refs distintos, alvo igual ao QA oficial e diferente de Production/DR; valida URL API, URL DB, URL pública, vínculo CLI e declarações Vercel. Falha com `FATAL — ENVIRONMENT ISOLATION GUARD FAILED`. Os valores Vercel declarados em arquivos locais não substituem a leitura independente da plataforma.

## Evidência obtida

Antes da aplicação, o projeto `odonto-class-qa` tinha zero migrations, tabelas públicas, usuários Auth, buckets e objetos Storage. Em 07/10/2026, as migrations versionadas `0001`–`0031` foram aplicadas somente ao QA por um workdir CLI isolado. A listagem remota posterior confirmou exatamente 31 migrations; `0030` e `0031` estão aplicadas. O QA passou a ter 35 tabelas públicas e um bucket; continua com zero usuários Auth e zero objetos Storage. O vínculo CLI principal agora aponta para QA. Production e DR não receberam escrita.

No Vercel, `NEXT_PUBLIC_SUPABASE_URL` de Production ainda aponta para Production; a mesma variável em Preview aponta para QA. A chave pública de Preview foi comparada em memória com a chave do QA e coincide. A chave `SUPABASE_SERVICE_ROLE_KEY` sensível foi atualizada no escopo Preview; a API do Vercel não permite reler seu valor para atestação independente. Development recebeu URL, chave pública e chave de serviço do QA; URL e chave pública foram comparadas em memória com o QA. A chave de serviço Development também é ilegível após gravação.

Advisors QA após migrations: segurança registrou um aviso informativo de tabela com RLS sem policy, dois avisos de execução anônima de funções `SECURITY DEFINER` e 112 avisos de execução autenticada dessas funções. Performance registrou 83 FKs sem índice, três avisos de `auth_rls_initplan`, 62 índices ainda não usados, uma sobreposição de policies permissivas e três índices duplicados. Esses avisos precisam de triagem contextual; não foram corrigidos por alteração remota ad hoc.

Arquivos locais ignorados `.env.local`, `.env.test.local` e `.env.homologacao.local` receberam URL, chave pública, chave service role e refs QA/Production/DR oficiais. Credenciais de atores antigos e a URL de banco antiga foram removidas. A senha do banco QA ainda não está disponível, então `SUPABASE_TEST_DB_URL` está ausente e o guard de execução remota permanece fechado. Nenhum segredo foi escrito em arquivo versionado ou impresso.

## Pendências para homologação

1. Obter uma URL de banco QA válida, guardada apenas localmente, e configurar Auth/redirects do QA. A leitura de `/auth/v1/settings` em 07/10/2026 confirmou `disable_signup=false`; o preflight exige signup público desabilitado. Não criar usuários reais.
2. Completar o runner de homologação remota e o cleanup dependente do manifesto. H01/H02 agora registram `runId`, `entity_type`, `entity_id`, `created_by` e `created_at` para suas linhas principais e o objeto Storage. O registro é local e posterior ao commit remoto; auditorias, `documento_cid` e valores de autoria/data no banco ainda não são conciliados. Assim, ele é preparatório, não prova ownership exaustivo. O cleanup legado por prefixo/audit permanece desativado e ainda não foi substituído.
3. Adaptar os cenários completos para o QA remoto. `npm run homologate` atual executa um laboratório Supabase local e sua fase remota é apenas read-only; portanto não certifica a primeira homologação no projeto QA. O runner 0030 legado foi travado em `homologation: BLOCKED` mesmo se H01/H02 passarem, até existir cleanup e prova completos.
4. Verificar as variáveis de CI e o fluxo de Preview sem deploy Production. Conferir os avisos dos advisors, incluindo funções `SECURITY DEFINER` executáveis por `anon`.
5. Executar preflight, testes, H01–H06, concorrência, RLS/RBAC, build, advisors, cleanup e prova de cleanup no QA, sem skips críticos, e obter revisão independente de segurança do resultado final.

Até concluir essas etapas, `HOMOLOGATION: BLOCKED` e `PRODUCTION GATE: NOT ELIGIBLE`. Os resíduos QA históricos em Production permanecem intocados.

## Revalidação de 07/10/2026 após configuração humana

- O guard local passou em todos os checks: refs oficiais distintos, URLs API/pública/DB e vínculo CLI apontam para QA. Nenhuma mutation foi iniciada nesta retomada.
- O endpoint Auth `/auth/v1/settings` do QA respondeu HTTP 200 com `disable_signup=false` e `external.email=true`. Logo, o cadastro público ainda está habilitado do ponto de vista do serviço; o gate obrigatório falha, apesar da alteração relatada no Dashboard.
- A conexão direta com o banco usando `SUPABASE_TEST_DB_URL` atingiu PostgreSQL mas recebeu SQLSTATE `28P01` (autenticação rejeitada). Host, usuário e projeto da URL correspondem ao QA; o segredo não foi exposto. O preflight 0030 retornou `read_only_database_query_failed`.
- A consulta administrativa read-only ao QA confirmou 31 migrations, zero usuários Auth, zero perfis e zero objetos Storage. O runner completo continua bloqueado; nenhuma fixture ou usuário foi criado nesta retomada.
- A configuração local continha duas entradas `SUPABASE_TEST_ENVIRONMENT`, a última com `qa`; removi a duplicata e deixei `homologation`, valor exigido pelo guard central. O preflight principal passou então no `Remote project guard`, mas continuou `BLOCKED` por `signup_disabled: FAIL` e `remote_database: BLOCKED`. Uma nova leitura Auth sem cache confirmou os mesmos valores.
- `npm run homologate` foi executado duas vezes com o preflight bloqueado, sem preparar stack ou fixtures. Na primeira, oito testes unitários legados falharam porque usavam `node:assert` sob `--expect.requireAssertions=true`; converti uma asserção substantiva de cada caso para Vitest `expect`. A segunda execução teve lint, typecheck, unitários, guard e diff PASS; conclusão `HOMOLOGATION: BLOCKED`, `PRODUCTION GATE: BLOCKED`, integração/H01–H06/cleanup não iniciados.
- Inventário adicional somente leitura encontrou zero pacientes, agendamentos, atendimentos, profissionais, materiais, lotes e auditorias no QA; nenhuma fixture residual inesperada apareceu nessas tabelas.
