# Sprint 2.3 — consistência de agenda e retornos (A1)

## Objetivo e critérios de aceite

Criar uma consulta comum ou vinculada a retorno sem duplicação em repetição e sem agendamento órfão se o vínculo falhar. A recepção/admin devem receber confirmação apenas após a RPC concluir, erro claro, retry com a mesma chave e link direto à consulta. O banco deve preservar autorização, conflito GiST, paciente/profissional/horário, vínculo único e consistência após cancelamento, falta ou edição.

## Estado atual e evidência

- Checkout atual: `C:/Users/ppedr/OneDrive/Desktop/Odonto-Class`, branch `teste/odonto-g1-s1`, remote `origin` apontando para `ppedromartins11/Odonto-Class`, HEAD `1f9e398`. A pasta histórica `clinica-odonto-mvp` não foi presumida equivalente.
- Worktree já sujo antes desta sprint: F1/F2, G1/S1 e outros arquivos rastreados/não rastreados; todos preservados. Há inclusive `.gitignore`, `package.json`, `package-lock.json` e um arquivo deletado com nome anômalo preexistentes.
- G1 presente em `scripts/homologacao/preflight.mjs` e testes de fingerprint; S1 presente em `lib/operational/storage-integrity.ts` e migration local 0034; F1 em `PaymentForm.tsx` e loader; F2 em `page.tsx` e `lib/financial/pagination.ts`. A presença local não prova aplicação de migrations ou homologação remota.
- Última migration local: `0034_verified_patient_upload_metadata.sql` não rastreada. Nenhuma 0035 ou posterior encontrada; próxima proposta é 0035. Estado de aplicação remota desconhecido, fora da consulta autorizada.
- Auditoria A1 em `docs/AUDITORIA_PRODUTO_ODONTO_CLASS.md:83`: `app/(app)/agenda/actions.ts` chama `create_appointment`, depois `link_return_appointment`; a segunda falha deixa a primeira gravação. Migrations 0004/0005 definem RPCs, exclusão GiST, FK/UNIQUE/CHECK; 0030 atualiza a edição da consulta. Testes de autorização/concorrência existentes foram inspecionados, sem execução remota.

## Requisitos e fora do escopo

- Criar agendamento e vínculo em uma única chamada SQL; rollback de agendamento e auditoria em falha de vínculo.
- Chave UUID de idempotência por formulário/ator; repetição da mesma intenção devolve o mesmo agendamento. Lock do retorno serializa operadores concorrentes; payload diferente para retorno já ligado é negado.
- Retorno agendado deve apontar para consulta ativa do mesmo paciente. Cancelamento/falta devolvem retorno a pendente na mesma transação; edição não pode trocar paciente de consulta vinculada.
- Sem alterar lógica clínica, S1, F1/F2, Auth/MFA, dados reais ou operações remotas.

## Arquitetura e responsáveis

| Arquivo | Responsabilidade | Owner |
| --- | --- | --- |
| `supabase/migrations/0035_agenda_return_consistency.sql` | RPC transacional, idempotência e invariantes posteriores | principal |
| `app/(app)/agenda/actions.ts`, `AppointmentForm.tsx`, `novo/page.tsx`, `lib/agenda/types.ts`, `lib/agenda/queries.ts` | Uma RPC, feedback, retry e navegação | principal |
| Testes focados e `tests/integration/agenda-return-consistency.test.ts` | Casos locais e preparação PostgreSQL | principal |
| Este plano | Evidência e riscos | principal |

`database` e `security_reviewer` fizeram revisão independente e somente leitura das RPCs, constraints e diff final. Ambos aprovaram a análise estática, sem P1/P2 remanescente. A revisão não comprova comportamento PostgreSQL em execução. Um arquivo crítico teve apenas um owner de escrita.

## Banco de dados e segurança

Migration 0035 é proposta local, aditiva e não aplicada. Reutilizar `create_appointment` e `link_return_appointment` mantém guardas de papel, validação de paciente/profissional, horários, exclusion constraint e auditoria. Nova RPC terá `SECURITY DEFINER`, `search_path = ''`, `auth.uid()` e GRANT só a `authenticated`; funções de trigger não serão expostas a chamadas diretas. Nenhuma tabela nova; `request_id` nullable e índice único em `agendamentos` para idempotência, sob RLS/grants existentes. Uma RPC corresponde a uma transação PostgreSQL: erro não capturado reverte todos os writes da chamada. Locks de chave e retorno impedem repetição concorrente. Integração com PostgreSQL descartável é necessária para comprovar essa hipótese e o comportamento de triggers.

## Etapas e progresso

| Etapa | Estado | Evidência |
| --- | --- | --- |
| Verificar checkout | concluída | Git, G1/S1/F1/F2 e migrations locais inspecionados |
| Analisar A1 | concluída | UI, actions, RPCs, constraints e testes existentes |
| Implementar localmente | concluída | Migration 0035, Action, formulário, carregamento de retorno e testes locais |
| Testar | concluída no escopo local disponível | 359 testes PASS, 1 skip; integração PostgreSQL preparada e não executada |
| Revisar independentemente | concluída estaticamente | Database e security reviewer: PASS estático; sem prova de atomicidade real |
| Validar e relatar | concluída localmente | Lint, typecheck, testes, build e diff check PASS; riscos abaixo |

## Testes e revisão

Testes focados de Action, formulário e página cobrem criação comum e vinculada, sucesso com ID confirmado, falhas conhecidas, estado desconhecido de rede, retry com mesma chave, retorno já vinculado, perfil negado e seleção protegida de paciente. A suíte `tests/integration/agenda-return-consistency.test.ts` prepara rollback forçado após insert, idempotência, concorrência de operadores, conflito, IDs inválidos, cancelamento/falta e remarcação. Ela exige URL e conexão PostgreSQL locais e marcador explícito de isolamento. A configuração encontrada aponta para URL Supabase não local e não contém `SUPABASE_TEST_DB_URL`; portanto a suíte integrada não foi executada. Mocks e revisão estática não comprovam atomicidade ou concorrência reais.

Validações locais em 20/11/2026:

| Comando | Resultado | Evidência |
| --- | --- | --- |
| `npm run lint` | PASS | ESLint, saída sem erros |
| `npm run typecheck` | PASS | `tsc --noEmit` |
| `npm test` | PASS | 62 arquivos, 359 testes PASS e 1 skip condicionado |
| `npm run build` | PASS | Next.js 16.4.6 compilou, tipou e gerou 35 páginas estáticas |
| `git diff --check` | PASS | Sem erro; avisos de conversão LF/CRLF em arquivos já no worktree |

Arquivos desta sprint: `supabase/migrations/0035_agenda_return_consistency.sql`, `app/(app)/agenda/actions.ts`, `app/(app)/agenda/AppointmentForm.tsx`, `app/(app)/agenda/novo/page.tsx`, `lib/agenda/queries.ts`, `lib/agenda/types.ts`, `app/(app)/agenda/actions.test.ts`, `app/(app)/agenda/AppointmentForm.test.tsx`, `app/(app)/agenda/novo/page.test.tsx`, `tests/integration/agenda-return-consistency.test.ts` e este plano. Mudanças F1/F2, G1/S1 e demais diferenças preexistentes foram preservadas.

## Riscos, reversão e conclusão

Migration 0035 foi apenas proposta localmente e não foi aplicada em nenhum banco. A nova Action depende dela: publicação do frontend antes da migration causaria `PGRST202`, tratado com mensagem explícita. A aplicação futura exige inventário do schema remoto, gates próprios e coordenação da versão da aplicação. O fingerprint de release existente espera 34 migrations e deve ser atualizado em trabalho de release coordenado antes de homologação; não foi alterado nesta sprint. Testes PostgreSQL de atomicidade, rollback e concorrência, além de teste visual/teclado com backend comprovadamente isolado, permanecem pendentes. Reversão local: remover apenas a implementação desta sprint, sem modificar o worktree preexistente. QA, Production, deploy e commit seguem fora do escopo.
