# Roadmap (Sprints)

- [x] **Sprint 0** - Infraestrutura: repositorio, Next.js+TS+Tailwind,
      Supabase (config, sem projeto real criado aqui), estrutura de
      pastas, documentacao, `CLAUDE.md`, Git local + commit, CI, pagina
      placeholder, empacotamento. Conclusao real do deploy/repos remotos
      depende do checklist em `docs/DEPLOYMENT.md`.
- [ ] **Sprint 1** - Autenticacao e usuarios (RF-01, RF-02). Tabelas:
      `usuarios`, `profissionais`.
- [ ] **Sprint 2** - Pacientes (RF-04, RF-05). Tabela: `pacientes`.
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
- [ ] **Sprint 9** - Testes e seguranca (RF-20, RN-05, RNF-01, RNF-07).
      Tabela: `auditoria`; policies de RLS em todas as tabelas.
- [ ] **Sprint 10** - Homologacao com a clinica (dados ficticios).

Detalhamento completo (objetivo, dependencias, testes, criterio de
conclusao) por sprint esta na especificacao tecnica aprovada, secao 9.

## Pontos a validar antes das sprints que os afetam

Ver `docs/DECISIONS.md`. Prioridade para os que afetam modelagem de
dados: PAV-01/PAV-02 (RBAC detalhado, antes da Sprint 1), PAV-18
(eventos de auditoria, antes da Sprint 9), PAV-19 (limites de upload,
antes da Sprint 5).
