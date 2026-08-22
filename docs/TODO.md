# Roadmap (Sprints)

- [x] **Sprint 0** - Infraestrutura: repositorio, Next.js+TS+Tailwind,
      Supabase (config, sem projeto real criado aqui), estrutura de
      pastas, documentacao, `CLAUDE.md`, Git local + commit, CI, pagina
      placeholder, empacotamento. Conclusao real do deploy/repos remotos
      depende do checklist em `docs/DEPLOYMENT.md`.
- [x] **Sprint 1** - Autenticacao e usuarios (RF-01, RF-02). Tabelas:
      `usuarios`, `profissionais` (RLS desde a criacao). Layout global
      (Sidebar/Header) adaptado do prototipo Figma Make. Login,
      recuperacao de senha, listagem e criacao de usuario (convite
      administrativo) implementados.
- [x] **Sprint 1.5** - Hardening de identidade e autorizacao. Codigo,
      migration aditiva, UI administrativa e auditoria minima validados;
      lint/typecheck/test/build, lint SQL e 7 testes RLS passam em
      homologacao ficticia. MFA admin e validacao manual dos templates/
      redirects permanecem gates separados de go-live.
- [ ] **Sprint 2** - Pacientes (RF-04, RF-05). Tabela: `pacientes`.
      Deve ser iniciada somente por pedido explicito; nao foi iniciada
      durante o hardening.
- [ ] **Sprint 3** - Agenda (RF-07, RF-08). Tabela: `agendamentos`.
- [ ] **Sprint 4** - Atendimento (RF-09, RF-06 parcial). Tabelas:
      `atendimentos`, `procedimentos`.
- [ ] **Sprint 5** - Documentos (RF-10, RF-11). Tabela: `documentos`.
- [ ] **Sprint 6** - Retornos e tarefas (RF-12, RF-13, RF-03 dashboard).
      Tabelas: `retornos`, `tarefas`.
- [ ] **Sprint 7** - Pagamentos e orcamento (RF-14, RF-15, RF-16).
      Tabelas: `pagamentos`, `orcamentos`, `orcamento_itens`.
- [ ] **Sprint 8** - Validade/esterilizacao (RF-17, RF-18). Tabela:
      `controle_validade`.
- [ ] **Sprint 9** - Testes e seguranca finais (RF-20, RN-05, RNF-01,
      RNF-07). `auditoria` minima ja existe desde a Sprint 1.5; ampliar
      eventos e revisar policies de todos os modulos.
- [ ] **Sprint 10** - Homologacao com a clinica (dados ficticios).

Detalhamento completo (objetivo, dependencias, testes, criterio de
conclusao) por sprint esta na especificacao tecnica aprovada, secao 9.

## Pontos a validar antes das sprints que os afetam

Ver `docs/DECISIONS.md`. Prioridade para os que afetam modelagem de
dados: PAV-19 (limites de upload, antes da Sprint 5). A matriz de cada
modulo futuro ainda precisa ser detalhada antes de sua migration, sob a
regra deny-by-default aprovada na Sprint 1.5.
