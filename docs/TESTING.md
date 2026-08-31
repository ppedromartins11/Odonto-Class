# Testes e Criterios de Aceitacao

## Estrategia

- CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes e build em todo
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
| RF-13 | Tarefas simples podem ser criadas, priorizadas, iniciadas, concluidas, canceladas e removidas logicamente; recorrencia esta fora do escopo atual. |
| RF-14/15 | Pagamento aparece vinculado ao paciente/atendimento ou orcamento (nunca ambos - PAV-10); indicadores batem com a soma dos pagamentos. |
| RF-16 | Orcamento permite adicionar itens, soma corretamente o total, permite alterar status. |
| RF-17/18 | Item com validade proxima do vencimento gera alerta antes da data de vencimento. |
| RF-19 | Arquivo anexado so e visivel a usuarios autorizados pelo RBAC vigente. |
| RF-20 | Acao critica (lista em `docs/SECURITY.md`, PAV-18) gera registro em `auditoria` com usuario e timestamp. |
| Sprint 12 | Estoque: entrada, saida, ajuste, saldo nao negativo, alertas cumulativos, RLS por perfil, historico e concorrencia basica. |
| Transversal | Usuario sem permissao nao consegue visualizar dado restrito de outro perfil, mesmo alterando a URL/requisicao diretamente. |

## Sprint 2 - Pacientes

- Busca por nome sem acento, por telefone normalizado e sem interpretacao
  de `%`/`_` como curingas fornecidos pelo usuario.
- Homonimos permitidos; documento opcional e fora da busca.
- Administrador, dentista e recepcao ativos podem manter dados
  administrativos; somente administrador altera status.
- Somente dentista ativo com `profissionais.status=ativo` recebe alertas
  clinicos. Administrador puro e recepcao recebem zero linhas, inclusive
  em chamada direta ao Supabase.
- Escrita direta, alteracao de metadados e `DELETE` sao recusados.
- Usuario inativo e autenticado sem perfil permanecem fail-closed.
- Auditoria registra somente IDs/campos alterados, nunca telefone,
  documento ou conteudo clinico.
- Suite remota e opt-in e limpa somente os UUIDs ficticios que criou.

## Sprint 10 - Orcamentos

- Unitarios cobrem status aceitos e valores inteiros em centavos.
- A suite remota opt-in `budgets.authorization.test.ts` usa exclusivamente
  fixtures `QA_ORC_`, testa administrador, recepcao, dentista proprio/outro,
  usuario inativo e Auth sem perfil; tambem cobre RLS de leitura, bloqueio de
  DML direto, ciclo rascunho/enviado/aprovado/convertido e auditoria sem
  observacao administrativa.
- O cleanup remove somente itens, orcamentos, pacientes, auditoria e
  identidades `QA_ORC_` criados pela propria suite.

## Sprint 1.5

- `npm test`: testes unitarios do token assinado de convite/recuperacao
  (valido, expirado, adulterado e segredo invalido).
- `npm run test:integration`: suite real de autorizacao contra Supabase,
  cobrindo administrador, dentista, recepcao, usuario inativo e usuario
  Auth sem perfil; tambem testa RPC administrativa, consistencia de
  profissional, protecao da propria conta e leitura da auditoria.
- A suite de integracao cria identidades ficticias descartaveis e as
  remove no `afterAll`. Ela se recusa a iniciar sem o marcador explicito
  `SUPABASE_TEST_HOMOLOGATION=I_ACKNOWLEDGE_FAKE_DATA_ONLY`.

Para executar:

1. Aplicar `0001` e `0002` em uma homologacao isolada.
2. Copiar `.env.test.example` para `.env.test.local` e preencher apenas
   credenciais da homologacao, a URI Postgres e um administrador de teste.
3. Rodar `npm run test:integration`.
4. Confirmar que nao ficaram usuarios `sprint15-*` apos o teste.

Estado em 22/08/2026: lint, typecheck, 3 testes unitarios, build e os 7
testes Supabase passam. O lint SQL remoto nao encontrou erros; migrations
`0001`/`0002` estao alinhadas no historico da homologacao. As identidades
criadas pela suite sao removidas no cleanup.

Estado da Sprint 2 em 22/08/2026: migration `0003` aplicada, lint SQL sem
erros, 9 testes unitarios e 15 testes de integracao/RLS passando. A suite
cobre busca, RPCs, escrita direta, `DELETE`, metadados, status, auditoria e
segregacao dos alertas clinicos. O cleanup foi conferido com zero usuarios e
zero pacientes de teste residuais.

## Bloco Agenda / Atendimento / Procedimentos

- Unitarios: datas/semana/fuso, intervalo de agenda, evolucao obrigatoria ao
  finalizar, limites e procedimento com/sem dente.
- Integracao/RLS: administrador, dois dentistas, recepcao, inativo e conta
  Auth sem perfil; agenda propria/geral; conflito concorrente; remarcacao;
  confirmacao/cancelamento/falta; atendimento agendado/direto; isolamento de
  evolucao; procedimentos; imutabilidade; escrita direta/DELETE e auditoria
  sem conteudo sensivel.
- Regressao: suites anteriores de Auth e Pacientes continuam no mesmo
  `npm run test:integration` e usam somente identidades/pacientes ficticios
  descartaveis.
- Manual: agenda dia/semana, busca remota de paciente, fluxo agendamento ->
  atendimento -> procedimento -> finalizacao -> status atendido, mais
  remarcacao/cancelamento/falta.

Depois de autorizacao explicita, a `0004` foi aplicada na homologacao: lint
SQL sem erros e 23 testes de integracao/RLS/RPC passaram (Auth, Pacientes e
bloco clinico). O cleanup terminou com zero usuarios, pacientes e agendamentos
ficticios residuais dos prefixos da suite.

## Tarefas: prioridade e remocao logica

- As migrations `0009` e `0010` foram aplicadas somente na homologacao
  ficticia em 26/08/2026, apos dry-run e reconciliacao do historico que ja
  continha as migrations historicas `0007` e `0008`.
- A suite remota completa passou com 29 testes. A cobertura operacional inclui
  prioridade padrao e permitida, assinatura legada de `create_task`, edicao,
  transicao de status, RLS, remocao logica e bloqueio de operacoes posteriores.
- O teste remoto depende de secrets do ambiente GitHub `homologacao-ficticia`;
  nunca incluir esses valores no repositorio ou em arquivos de exemplo.

## Sprint 11: Financeiro basico

- Unitarios cobrem formas/status aceitos e valores monetarios inteiros,
  positivos e limitados em centavos.
- Integracao/RLS cobre administrador, recepcao, dentista proprio e de outro
  profissional, usuario inativo e conta sem perfil; tambem cobre IDOR,
  referencias de paciente divergente, referencia dupla, pagamento duplicado,
  DML direto negado, cancelamento/estorno e auditoria sem observacao.
- A suite cria somente fixtures `QA_FIN_` e as remove no `afterAll`.
  Apos a execucao de homologacao, a contagem de pacientes e usuarios
  `QA_FIN_` deve ser zero.

## Sprint 13: Servicos, consumo e finalizacao

- A suite remota `services.attendance-stock.authorization.test.ts` usa apenas
  fixtures `QA_SVC_` e cobre catalogo administrativo, isolamento da recepcao,
  isolamento entre dentistas, usuario inativo e Auth sem perfil.
- Cobre servico sem material, snapshot de composicao, valor historico,
  quantidade multiplicada, preview sem escrita, saldo suficiente e exato,
  estoque insuficiente, material inativo, multiplos materiais, rollback,
  indice contra dupla baixa e finalizacoes realmente concorrentes.
- A limpeza remove somente os IDs descartaveis criados pela propria suite.
  Ao concluir, nao pode restar registro com prefixo `QA_SVC_`.

## Sprint 9.5 — checklist de homologação manual

Executar exclusivamente na homologação fictícia, com dados descartáveis e
limpando somente o que for criado no roteiro.

- **Administrador:** login, Dashboard, Pacientes, Usuários, Agenda e
  Documentos; conferir mensagens de erro sem detalhes internos.
- **Recepção:** cadastrar paciente, criar/confirmar agendamento, agendar
  retorno e gerar documento administrativo. Confirmar bloqueio de evolução,
  procedimentos e arquivos clínicos, inclusive por URL direta.
- **Dentista:** conferir apenas a própria agenda e seus atendimentos; iniciar
  atendimento, registrar evolução/procedimento e criar retorno. Conferir que
  não acessa dados clínicos de outro profissional.
- **Agenda:** cancelar a consulta A e criar a consulta B no mesmo intervalo.
  B permanece na grade; A fica somente no histórico visual.
- **Retornos:** validar busca por paciente, filtros Todos/Pendentes/Agendados/
  Concluídos/Cancelados/Atrasados, estado vazio e paginação.
- **Tarefas:** validar filtros Todas/Pendentes/Em andamento/Concluídas/
  Atrasadas/Minhas, ordenação por prazo, paginação, conclusão e remoção
  lógica.
- **Responsividade:** repetir navegação principal em 1366×768, 1920×1080 e
  viewport móvel; tabelas não podem transbordar fora do contêiner, drawers
  fecham e formulários permanecem utilizáveis.
