# Modelo de ExecPlan

Copie para `docs/plans/<tema>.md` em módulo novo, mudança arquitetural, Auth/RLS/migration, financeiro, estoque, refatoração ampla ou tarefa entre domínios. Mantenha-o atualizado durante a execução; uma correção pequena não precisa de arquivo.

## Objetivo e critérios de aceite

- Resultado observável:
- Critérios verificáveis:

## Estado atual e evidência

- Fluxo e arquivos inspecionados:
- Testes/schema/migrations relevantes:
- Estado Git e ambiente confirmado (sem secrets):

## Requisitos e fora do escopo

- Regras de negócio e invariantes:
- Exclusões explícitas:
- Ambiguidades que exigem decisão:

## Arquitetura e responsáveis

- Contratos app/UI/banco e compatibilidade:
- Especialistas acionados, owner de cada arquivo e revisão independente:
- Dependências e oportunidades reais de paralelismo:

## Arquivos impactados

| Arquivo ou grupo | Mudança prevista | Owner |
| --- | --- | --- |
|  |  |  |

## Banco de dados e segurança

- Migration nova ou “não se aplica”; última aplicada comprovada:
- RLS, grants, RPCs, SECURITY DEFINER/search_path, acesso por papel:
- Transações, concorrência, falhas parciais e migração de dados:
- Dados clínicos/financeiros, Storage, Auth/MFA, logs e secrets:
- Gates remotos, backup e autorização necessária:

## Etapas e progresso

| Etapa | Responsável | Estado (pendente/em curso/concluída/bloqueada) | Evidência |
| --- | --- | --- | --- |
| Analisar |  |  |  |
| Implementar localmente |  |  |  |
| Testar |  |  |  |
| Revisar independentemente |  |  |  |
| Validar e relatar |  |  |  |

## Testes e revisão

- Comandos focados e resultado real:
- Integração isolada autorizada? Ambiente e cleanup:
- Revisão de segurança: achados, correções e segunda revisão:
- `git diff --check` e escopo do diff:

## Riscos, reversão e conclusão

- Riscos residuais e mitigação:
- Plano de reversão local/compatibilidade de release:
- Critérios de conclusão atendidos ou pendentes:
- Próximo passo autorizado; operações remotas ainda não executadas:
