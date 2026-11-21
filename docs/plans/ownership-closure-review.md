# Fechamento read-only de ownership QA

Data da análise: 06/10/2026 (America/Cuiaba). Base: [inventário remoto](../../artifacts/homologacao/remote-inventory/latest.md) capturado em transação `READ ONLY`/`REPEATABLE READ`, SHA-256 `6e326c8e95455ab3a767a7d46529497699f95ad60c35fe73db0485345e5d2b6f`. A análise subsequente usa esse snapshot, sem alteração remota. [Classificação independente do ambiente](environment-classification.md): alvo configurado em Vercel Production e Preview, Gate A BLOCKED.

## Perfil renomeado

`public.usuarios.id = 414dae79-0fe7-499a-9016-f6fea7451334` permanece **OWNERSHIP_PROBABLE**. Auth e perfil têm o mesmo ID, email igual e `created_at` exatamente `2026-09-22T01:18:44.290Z`. O profissional ligado ao perfil foi criado no mesmo instante. O email Auth segue o formato reservado `qa_usr_dentista_<uuid>@example.com`; o `raw_user_meta_data.nome` atual ainda corresponde ao mesmo UUID e papel, enquanto o nome atual do perfil perdeu esse UUID após renomeação. `raw_app_meta_data` contém apenas chaves de provider, sem marcador QA adicional. Esses valores foram comparados no banco e o email, token e metadata integral não foram exportados.

A [suíte de usuários](../../tests/integration/users-professional-profile.authorization.test.ts) gera esse formato e renomeia dentistas para nomes fixos. Isso explica a divergência, mas não vincula de modo imutável esse **ID específico** a um run. `raw_user_meta_data` pode ser editada pelo usuário e foi usada só como evidência histórica, nunca como autorização. Seu campo `created_by` aponta para identidade que já não existe em Auth/perfis, então a autoria não pode ser validada diretamente. O convite foi removido (`convites_provisionamento` atual: 0). A auditoria pública para esse ID contém apenas desativação e ativação posteriores, ambas por ator fora do conjunto QA candidato; não há evento de criação. `auth.audit_log_entries` não retornou entrada contendo esse ID. Falta manifesto imutável do run, registro administrativo de convite/criação preservado ou outra prova independente equivalente. **Deletable: no.**

O índice [histórico por UUID](../../artifacts/homologacao/ownership-history/latest.md), gerado por `npm run homologate:trace-artifacts`, examinou 77 IDs candidatos em 44 relatórios/logs/artefatos de execução anteriores: zero aparições. O ID ambíguo só foi encontrado nos snapshots remotos derivados, excluídos desse índice; `first_seen_run`, `last_seen_run` e `artifact` são `NONE`. Os artefatos históricos não foram modificados. Uma busca `git log -S` pelo UUID no código/documentos também não encontrou criação registrada.

## Dependências

O [relatório por ID e FK](../../artifacts/homologacao/ownership-closure/latest.md), reproduzível com `npm run homologate:ownership-closure`, registra para cada linha tabela, ID, pai/ator, mecanismo de origem, confiança e `deletable`. O algoritmo exige `created_by` de identidade QA confirmada e **todos** os pais de FKs não nulas no fechamento QA confirmado; a única exceção são profissionais provisionados por trigger junto a um perfil dentista confirmado, com FK `usuario_id` e instante de criação coincidente. FK para pai fora do snapshot ou pai ambíguo bloqueia a linha. `updated_by` isolado não é prova de criação. A comparação com a suíte `QA_ODO_` e as migrations de provisionamento sustenta esses mecanismos; não se infere origem por prefixo ou horário isolado.

| Tabela | Total | Confirmados | Bloqueados | Mecanismo principal |
| --- | ---: | ---: | ---: | --- |
| `profissionais` | 7 | 6 | 1 | FK para perfil dentista QA, criado no mesmo instante pelo trigger |
| `atendimentos` | 8 | 8 | 0 | dentista QA criador + paciente e profissional QA por FK |
| `procedimentos` | 8 | 8 | 0 | dentista QA criador + atendimento QA por FK + marcador da suíte |
| `movimentacoes_estoque` | 2 | 2 | 0 | criador QA + material e demais pais não nulos QA por FK |
| `servico_materiais` | 1 | 1 | 0 | criador QA + serviço/material QA por FK |
| `procedimento_materiais_consumo` | 1 | 1 | 0 | criador QA + procedimento/material/composição QA por FK |
| `consumos_clinicos_materiais` | 1 | 1 | 0 | criador QA + procedimento/material/movimento/snapshot QA por FK |

O único dependente bloqueado é `profissionais.id = 31f38314-e15a-422c-83b4-a3ddf48840b9`, cuja FK aponta ao perfil renomeado ainda provável. **DEPENDENCIES_TOTAL = 28; DEPENDENCIES_CONFIRMED = 27; DEPENDENCIES_BLOCKED = 1.** Confirmar origem não autoriza exclusão, e todos estão marcados `deletable: no`.

## Auditoria e retenção

Há 25 eventos relacionados: 23 `RELATED_BUT_NOT_EXCLUSIVE` ligados a raízes confirmadas e dois `UNKNOWN` ligados ao perfil provável. O ator dos eventos é externo ao conjunto QA candidato; 24 são ativações/desativações posteriores e um é convite de outro administrador. `QA_EXCLUSIVE = 0`; `AUDIT_BLOCKED = 25`. Cada evento, ator, entidade, ID e confiança consta do relatório por ID. Nenhum `dados` JSON, observação clínica ou conteúdo livre foi exportado.

[SECURITY.md](../SECURITY.md) define `auditoria` append-only, sem descarte automático, retenção provisória de **24 meses** e descarte só após prazo aplicável, autorização formal, verificação de backup/hold e evidência sanitizada. [DECISIONS.md](../DECISIONS.md) mantém exclusão física de prontuário desabilitada e exclusão lógica como padrão. Os 25 eventos devem ser preservados; nem mesmo um evento eventualmente classificado QA_EXCLUSIVE poderia ser apagado automaticamente agora.

## Gates e próximo passo

`ROOTS_TOTAL = 24`: 23 `OWNERSHIP_CONFIRMED`, 1 `OWNERSHIP_PROBABLE`, 0 `OWNERSHIP_UNKNOWN`, 0 `NON_QA` **no conjunto candidato**. `OWNERSHIP_CLOSURE: BLOCKED`. `ENVIRONMENT_CLASSIFICATION: BLOCKED` por vínculo Vercel Production. `SAFE_TO_DELETE_CONFIRMED_QA = 0`; `REMOTE_CLEANUP_GATE: BLOCKED`. Nenhum cleanup, migration, mudança de Auth, deploy ou escrita remota ocorreu.

Para prosseguir, o proprietário precisa identificar um projeto QA exclusivo e provar em configuração administrativa que Production usa outro ref; veja a ação objetiva no relatório de ambiente. A origem do perfil renomeado também requer prova independente e durável do run/criação. Após isso, novo inventário read-only no **projeto QA correto** e nova revisão independente serão necessários. Os eventos de auditoria permanecem sujeitos à política de retenção.

## Integridade do snapshot e limite da recaptura

O SHA-256 histórico acima cobre apenas parte do inventário; não protege `records` nem `uncertainties`. O produtor e o fechamento offline agora usam um digest compartilhado que inclui essas seções, além de FKs, triggers e demais dados de decisão. Os testes locais rejeitam mudança em `records[*].created_by` sem novo hash. Uma tentativa de recaptura `READ ONLY` em 06/10/2026 não retornou após vários minutos e foi interrompida; não gerou artefato novo. O snapshot histórico não foi reescrito. Assim, os totais desta análise correspondem ao fechamento anterior, mas **o novo verificador de integridade ainda não foi validado contra uma nova captura remota**. Reexecutar o inventário no projeto QA correto é condição para atualizar o relatório e submetê-lo à revisão final.
