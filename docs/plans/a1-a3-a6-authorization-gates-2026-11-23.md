# Decisões autorizadas — A1, A3, A6 e A7 (23/11/2026)

## Permissão exata do responsável
- **A1:** backup atualizado + Storage privado e restauração isolada: AUTORIZADO, mas a execução remota requer máquina/destino seguro e conectividade de dump.
- **A3:** analisar e preparar conciliação do histórico de migrations: AUTORIZADO; nenhuma alteração no ledger remoto até revisão.
- **A6:** proteger a branch `main`: AUTORIZADO; exige GitHub Settings, pois a integração conectada não dispõe de escrita em rulesets/branch protection.
- **A7:** desenvolver transação atômica de orçamento **isoladamente**: AUTORIZADO; não instalar SQL nem substituir o fluxo de produção sem testes.
- **A2, A4:** condicionadas à restauração efetiva e testes de integração PostgreSQL; **NÃO executar antes do gate**.
- **A5:** exclusão de `HOMOLOG_` **NEGADA**. Não executar nenhuma limpeza.

## A1 — Pré-voo confirmado, backup ainda não produzido nesta execução

Inventário somente leitura do projeto Supabase Production `clinica` (`sqouddqzpmkofenyufuj`):

| Indicador | Atual |
| --- | ---: |
| PostgreSQL | 17.11 |
| Migrations no ledger | 32 |
| Maior versão | `20261123133303` |
| Contas Auth / perfis | 24 / 24 |
| Pacientes / agenda | 22 / 17 |
| Orçamentos / versões PDF | 2 / 1 |
| Objetos no bucket privado | 11 |
| Pacientes identificados `HOMOLOG_` | 12 |
| Bucket `arquivos-paciente` privado | Confirmado |

**Bloqueio operacional:** o conector Supabase oferece consultas/DDL, mas não uma exportação binária completa (PG dump + Auth e bytes de Storage) para destino privado criptografado. Este ambiente de execução não tem a conexão PostgreSQL da máquina do operador nem um diretório privado validado para receber informações clínicas. **Não imitar backup com SELECT de tabelas**, não despejar PII no chat/GitHub.

**Segundo bloqueio:** o executor `scripts/recovery-database-backup.mjs` foi construído com gate fixo de `0001–0031`, pendências `0032/0033`, manifesto até `0031`, e baseline de PostgreSQL 17.6. O banco agora tem A1 `20261123133303`, PostgreSQL 17.11 e `0034` pendente. Rodar o backup anterior como se já estivesse atualizado é incorreto; o próprio validador deve falhar fechado. O restore `scripts/recovery-restore-rehearsal.mjs` também exige manifest antigo (31 migrations).

**Plano seguro para executar A1 no computador autorizado:**
1. Verificar que o diretório de backup fica **fora do OneDrive/Git**, tem acesso ACL privado, criptografia em repouso e espaço suficiente; sem expor caminhos sensíveis em PRs.
2. Revalidar conexão PostgreSQL de leitura com TLS `verify-full` e ref do projeto, além da lista completa de migrations, versão server/client e Auth/storage. *Jamais* inserir senha em argumentos/commits/chat.
3. Atualizar os guards de dump/restore e seus testes para a topologia atual **sem relaxar as checagens de integridade**. Submeter ao review antes de executar. Utilizar exportação oficial PostgreSQL/CLI em snapshot consistente, mantendo Auth reduzido e sem sessões/tokens/fatores MFA.
4. Exportar metadados e **separadamente os bytes** dos 11 objetos atuais de Storage privado; hash SHA-256 e manifest privado. O dump SQL isolado **não** preserva os bytes dos PDFs.
5. Importar o conjunto em Docker/PostgreSQL descartável, offline/isolado, preservar RLS/ACLs/triggers, reconciliar FKs, contagens e hashes; testar auth sintético e downloads sem URL pública.
6. Armazenar evidência sanitizada (checksums/contagens/resultado) e política de retenção; manter backup bruto privado e criptografado. Somente **RESTORE PASS** libera A2/A4 para teste final.

**A1 status: PREFLIGHT READ-ONLY PASS; BACKUP/RESTORE NÃO EXECUTADOS.** Não reportar A1 concluído.

## A3 — Reconciliação do ledger e tratamento da 0032

Estado remoto, confirmado na catalogação:
- Aplicadas `0001` a `0031` e `20261123133303_agenda_return_consistency`.
- Ausentes `0032_initial_admin_bootstrap`, `0033_security_internal_helpers_and_budget_pdf_path`, `0034_verified_patient_upload_metadata`.
- Schemas `bootstrap_private` e `document_private` ausentes. RPCs verificados de upload ausentes.
- `0032` contém mecanismo de bootstrap inicial para instalação vazia, e há **24 contas**. Seu efeito nos triggers de Auth de instalações existentes precisa de prova isolada; nem é seguro declarar SQL `0032` já aplicado, nem assumir que ele deve ser ignorado.

**Procedimento de homologação A3 (sem alterações remotas agora):**
1. Reconstruir ambiente descartável com mesmo conjunto de migrations e **dados fictícios**, simulando instalação já inicializada (Auth, perfis, convites) e instalação nova.
2. Avaliar assinatura/efeito dos triggers de `0032` em criação/convite e proteção contra bootstrap indevido. Definir: aplicar `0032` integralmente, substituir por migration de adaptação ou aposentar código específico, **somente com decisão documentada**.
3. Aplicar `0033` no laboratório e confirmar wrappers/gatilhos, bloqueio de helper por `anon` e constraint de path de PDF, sem regressões.
4. Aplicar `0034` no laboratório; testar Storage, atestação de bytes, metadata, arquivo/documento, replay, expiração e limpeza pós-falha.
5. Conferir conflito de versões: o Supabase remoto contém uma versão timestamp **posterior** aos arquivos `0032`–`0034`. Não executar `supabase db push` ou `migration repair --status applied` por tentativa e erro. Se houver renomeação/versionamento aditivo, preservar conteúdo e proveniência e registrar o mapa antes de submeter uma proposta.
6. Somente após A1 RESTORE PASS e testes reais em PostgreSQL fictício: solicitar autorização para aplicar A2/A4 e reconciliar o ledger remoto.

**A3 status: análise e plano concluídos; reconciliação remota NÃO executada.**

## A6 — Configuração manual no GitHub

O endpoint administrativo `GET /branches/main/protection` retornou `403 Resource not accessible by integration`, e não há regrasets cadastrados. O GitHub conectado pode editar código/PRs, mas **não pode criar regras de branch**. O responsável autorizou A6, porém não é possível afirmar que a proteção foi ativada.

**Abrir** [Repository Rules](https://github.com/ppedromartins11/Odonto-Class/settings/rules) pelo navegador autenticado, criar **New branch ruleset**, aplicar à `main`, ativar:
- Require a pull request before merging;
- Require status checks to pass before merging: selecionar o check real do workflow **CI / build** (nome exibido pelo GitHub) e evitar exigir o job `integration` que só executa manualmente;
- Block force pushes e Restrict deletions;
- Require conversation resolution se houver revisão de PR;
- Se for único colaborador, não exigir aprovação de outro usuário inexistente; caso exista revisor, exigir uma aprovação independente.

Salvar e confirmar regra **Active**, depois testar um PR para verificar que o merge é bloqueado antes do CI. Regrasets em contas/planos diferentes podem oferecer opções distintas.

**A6 status: plano pronto; alteração GitHub Settings ainda pendente da ação do titular.**

## A7 — Desenvolvimento isolado

A RPC `save_budget_atomic` e os testes vivem no [PR de laboratório](https://github.com/ppedromartins11/Odonto-Class/pull/14). A migration não existe na produção. A implementação utiliza as RPCs de orçamento existentes dentro de uma só chamada PostgreSQL (mesma transação), bloqueia UUIDs de outros orçamentos, itens duplicados e salvamentos parciais; a app não faz fallback no erro.

**Gates antes do merge:** CI estático + testes de integração SQL reais simulando: sucesso, exceção no último item que deve desfazer **todas** as alterações e auditorias, concorrência, autorização de dentista versus recepção, atualização de orçamento alheio, input malformado, envio/validade, timeout e duplicidade. **Não aplicar a migration nem publicar a Server Action na produção antes desses gates.**

## Política de bloqueios

**A5 NEGADO.** Nenhum paciente, atendimento, orçamento, pagamento, arquivo ou objeto do Storage foi excluído. A2/A4 não foram aplicadas. Nenhum segredo, credencial ou dado clínico foi publicado neste documento.
