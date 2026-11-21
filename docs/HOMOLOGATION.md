# Homologação automatizada

O especialista `qa` mantém a homologação, com consulta a `database`, revisão independente de `security_reviewer` e gates de `release`. Não foi criado outro agente. O lead integra e decide a conclusão.

## Comandos

```sh
npm run homologate
npm run homologate:preflight
npm run homologate:local
npm run homologate:remote
npm run homologate:inventory-remote
npm run homologate:trace-artifacts
npm run homologate:ownership-closure
npm run homologate:h01
npm run homologate:h02
npm run homologate:h03
npm run homologate:h04
npm run homologate:h05
npm run homologate:h06
npm run homologate:verify
npm run homologate:cleanup
```

No PowerShell com execução de scripts bloqueada, usar `npm.cmd`.

`homologate` executa preflight, checkpoint remoto read-only, lint, typecheck, unitários, laboratório local, build/app HTTP, integração completa, advisors, cleanup/proof e diff check. O guard de isolamento remoto deve passar antes de qualquer fase que prepare o laboratório, inclusive `local`, H01–H06 e `cleanup`. `remote` e `verify` consultam apenas o estado atual do alvo remoto autorizado. Não executam fixtures adversariais remotas. `cleanup` reconstrói exclusivamente o laboratório dedicado reconhecido. Recuperação seletiva 0030 permanece em comando histórico específico, agora sujeito ao mesmo guard central.

O runner não executa migrations remotas, resets remotos, deploy, commit ou push. Integração remota mutável não é incluída implicitamente: sua preparação/autorização específica permanece uma etapa operacional separada. Nenhum comando acima promove Production.

`homologate:inventory-remote` consulta o alvo vinculado em transação `READ ONLY`, com snapshot `REPEATABLE READ`. O relatório por ID fica em `artifacts/homologacao/remote-inventory/latest.md/json`. A rotina descobre os registros QA, seus vínculos por FK, Auth, auditoria e contagens de Storage, sem exportar conteúdo clínico, emails ou paths. Ela aceita somente o modo de inventário; `--execute` é recusado. Origem confirmada de uma raiz não autoriza apagar dependentes. O relatório bloqueia cleanup se houver ownership, vínculo ou identidade do ambiente não comprovados. [Plano e resultado da investigação](plans/remote-qa-residue-cleanup.md).

`homologate:trace-artifacts` gera índice local dos UUIDs do inventário em relatórios históricos, sem tocar nos artefatos antigos. `homologate:ownership-closure` usa o snapshot local para avaliar a cadeia de FKs e a retenção de auditoria, sem nova conexão remota. Ambos gravam somente relatórios ignorados em `artifacts/homologacao/`. O resultado atual e o vínculo Vercel Production estão em [ownership-closure-review.md](plans/ownership-closure-review.md) e [environment-classification.md](plans/environment-classification.md).

## Ambiente e segurança

Node 24, dependências npm instaladas, Docker ativo e CLI local instalada são necessários. O CLI é chamado sem shell, com `--help` para verificar comandos/flags. Portas vêm da configuração gerada e do `supabase status --output json`; credenciais ficam somente na memória do processo. CLI status e resultados Vitest brutos nunca são copiados aos relatórios.

O laboratório dedicado fica em `artifacts/homologacao/local-stack`, sem vínculo remoto. Seu project ID inclui hash do caminho canônico do repositório. Marker, lock e validação de diretório protegem contra adoção de stack alheia. Reset usa exclusivamente `--local --no-seed` nessa stack reconhecida. Nenhuma stack existente de outro projeto é parada. Conflito de porta encerra o start, sem loop de tentativas; investigar Docker/processos e a configuração gerada.

Migrations 0001–0029 são copiadas intactas, bootstrap inicial fictício é realizado pelo procedimento local confiável e 0030–0031 são aplicadas via CLI somente no laboratório. O perfil de bootstrap é inserido por SQL local confiável; metadata cliente não concede autoridade. Signup adversarial e limites de Auth ampliados existem somente nesse laboratório para testar o trigger e os cenários H05. Nunca alterar signup remoto para passar esses testes.

O checkpoint remoto carrega `.env.local`, `.env.test.local`, `.env.homologacao.local` nessa ordem; variáveis explícitas do processo prevalecem. São necessários:

- `SUPABASE_TEST_HOMOLOGATION=I_ACKNOWLEDGE_FAKE_DATA_ONLY`;
- `SUPABASE_TEST_ENVIRONMENT=homologation`;
- refs QA e Production explícitos, válidos e distintos; ref esperado QA, URL API, DB URL e anon key;
- refs dos bindings Vercel Preview/Production coerentes, sujeitos a conferência administrativa independente;
- vínculo CLI em `supabase/.temp/project-ref` com o mesmo ref;
- URL pública Supabase obrigatória e consistente, e ausência de marcador Production;
- `SUPABASE_PRODUCTION_PROJECT_REFS` com refs de Production conhecidas, separadas por vírgula, quando disponíveis; sua ausência não bloqueia o checkpoint read-only, mas impede tratá-lo como prova de exclusão de Production para escrita;
- quatro identidades QA pelos nomes/variáveis definidos no harness 0030.

DB direto exige `db.<ref>.supabase.co`; pooler exige host oficial e usuário `postgres.<ref>`. Falta/divergência bloqueia o caminho mutável antes da conexão: `FATAL — ENVIRONMENT ISOLATION GUARD FAILED`. O ref observado em Vercel Production está proibido também no código. A execução local substitui URLs/chaves por valores loopback e não modifica arquivos `.env` reais. `.env.homologacao.example` contém somente placeholders.

O guard detecta inconsistências locais e bloqueia o ref Production observado, mas variáveis `VERCEL_*` do mesmo processo não provam o binding real. Production e Preview ainda compartilham esse ref; `ENVIRONMENT_ISOLATION: FAIL`. Nenhuma integração remota mutável ou cleanup está liberado. Veja [environment-separation.md](plans/environment-separation.md).

## Gates e evidências

| Gate | Suítes atuais |
| --- | --- |
| H01 | documents-official.authorization, documents-official.cleanup-proof, release-highs HTTP/PDF |
| H02 | clinical-flow, users-professional-profile, release-highs |
| H03 | budgets.authorization, release-highs ACL/overloads |
| H04 | mfa-aal2.authorization, release-highs sessões AAL1/AAL2 |
| H05 | quatro cenários release-highs de metadata/convite/token/expiração/replay/atomicidade |
| H06 | lot-finalization.concurrency, service-procedure.concurrency, clinical-lot-traceability, release-highs, services.attendance-stock, stock |

Todos os arquivos `tests/integration/*.test.ts` são descobertos no fluxo completo. As três suítes local-only mantêm seus safety gates. O runner usa o script oficial `test:integration` e sua configuração, exige assertions e arquivo esperado presente. Zero testes, skip/todo, ausência de JSON, hook/cleanup falho, processo não-zero ou ambiente divergente impedem PASS. Concorrência exige pelo menos os 64 e 106 casos atuais executados. O arquivo release-highs exige app loopback compilada contra o laboratório, tornando obrigatório seu trecho HTTP.

As suítes executam uma por processo, evitando reordenação de cleanup pelo Vitest. Os cleanup-proofs existentes rodam depois das demais suítes e do cleanup global existente, que só pode ser usado no laboratório descartável. Depois, o bootstrap é removido por UUID próprio e uma consulta read-only compara PKs de todas as tabelas públicas, Auth users/identities/MFA/sessions e Storage objects com o baseline anterior ao bootstrap. A única mudança de tabela aceita é `convites_provisionamento`, criada pela 0030 e vazia. A prova verifica ausência de linhas adicionadas e preservação das identidades anteriores; não compara conteúdo clínico. Erro de cleanup/proof bloqueia o gate mesmo que testes tenham passado.

Advisors security/performance são consultados antes/depois dos testes locais. Findings novos bloqueiam; findings iguais são classificados como preexistentes e exigem revisão de release, incluindo SECURITY DEFINER. Ausência/formatos desconhecidos bloqueiam. Avisos históricos não são corrigidos automaticamente. Advisors remotos não são apresentados como executados pelo checkpoint read-only de banco; sua revisão faz parte da release remota separada.

## Relatórios e retomada

Cada run grava `artifacts/homologacao/latest.json`, `latest.md`, `runs/<runId>.json/md` e `logs/<runId>.jsonl`. Os logs são eventos permitidos por campo, não saída bruta. Identificador, timestamp UTC, branch, commit completo, worktree, versões, hashes das migrations, project guards, suítes/contagens/skips, cleanup, advisors, duração e conclusão ficam registrados. Nenhuma evidência anterior é mesclada como PASS. A conclusão é PASS/FAIL/BLOCKED; um run parcial não pode aprovar o fluxo global. Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED.

Docker/CLI/images/portas/app/configuração indisponíveis produzem bloqueio explícito. Após resolver a dependência, repetir o comando gera uma nova evidência. Um lock abandonado após encerramento abrupto exige verificar que o PID terminou e que o diretório/project ID pertencem ao runner antes de remover apenas esse lock. A stack local é mantida para inspeção, sem fixtures de teste quando cleanup PASS. Artefatos são ignorados pelo Git. Estado de migrations remotas é proveniente de consulta atual, nunca do texto histórico de sprint.
