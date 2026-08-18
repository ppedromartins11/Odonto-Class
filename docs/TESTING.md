# Testes e Criterios de Aceitacao

## Estrategia

- CI (`.github/workflows/ci.yml`) roda lint, typecheck e build em todo
  push/PR para `main`. Testes automatizados especificos por
  funcionalidade sao adicionados a partir da Sprint 1.
- Toda funcionalidade que toca dado clinico ou financeiro precisa de
  pelo menos um teste de autorizacao (RN-05: usuario sem permissao nao
  acessa dado de outro perfil), alem do teste funcional.
- Testes de integracao contra o Supabase devem usar um projeto/ambiente
  de teste com dados ficticios - nunca dados reais (RN-09).

## Criterios de aceitacao por requisito (resumo)

| RF | Criterio objetivo |
|---|---|
| RF-01 | Login com credencial invalida e rejeitado; logout encerra a sessao. |
| RF-02 | Usuario sem perfil administrador nao cria/altera outro usuario, nem via UI nem via API direta. |
| RF-03 | Dashboard exibe consultas, retornos pendentes, tarefas do dia e alertas de validade sem navegacao adicional. |
| RF-04/05 | Paciente cadastrado e encontrado imediatamente na busca por nome. |
| RF-06 | Abrir paciente exibe consultas, historico, documentos, pagamentos e retornos relacionados. |
| RF-07/08 | Consulta pode ser criada, remarcada, cancelada, confirmada e marcada como falta; paciente acessivel a partir da consulta. |
| RF-09 | Atendimento salvo registra evolucao, profissional e vinculo com paciente/consulta. |
| RF-10/11 | Atestado gerado usa dados reais do paciente/profissional, gera PDF valido e fica salvo/anexado. |
| RF-12 | Retorno aparece em "pendentes" até status ser atualizado. |
| RF-13 | Tarefas recorrentes reaparecem conforme periodicidade; concluidas saem da lista de pendentes. |
| RF-14/15 | Pagamento aparece vinculado ao paciente/atendimento ou orcamento (nunca ambos - PAV-10); indicadores batem com a soma dos pagamentos. |
| RF-16 | Orcamento permite adicionar itens, soma corretamente o total, permite alterar status. |
| RF-17/18 | Item com validade proxima do vencimento gera alerta antes da data de vencimento. |
| RF-19 | Arquivo anexado so e visivel a usuarios autorizados pelo RBAC vigente. |
| RF-20 | Acao critica (lista em `docs/SECURITY.md`, PAV-18) gera registro em `auditoria` com usuario e timestamp. |
| Transversal | Usuario sem permissao nao consegue visualizar dado restrito de outro perfil, mesmo alterando a URL/requisicao diretamente. |

## Estado na Sprint 0

Nenhum teste automatizado foi criado ainda - nao ha funcionalidade para
testar. O pipeline de CI existe, mas so sera executado de fato apos o
primeiro push para um repositorio remoto (ver `docs/DEPLOYMENT.md`).
