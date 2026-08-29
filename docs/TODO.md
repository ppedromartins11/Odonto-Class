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
- [x] **Sprint 2** - Pacientes (RF-04, RF-05, RF-06 parcial, RF-20).
      `pacientes`, `paciente_alertas_clinicos`, busca nome/telefone, ficha,
      RPCs, RLS e auditoria validados. Migration `0003`, lint SQL e 15
      testes de integracao/autorizacao passaram em homologacao ficticia.
- [x] **Bloco clinico integrado (substitui Sprints 3/4 separadas)** - Agenda,
      atendimento e procedimentos homologados manualmente.
- [x] **Sprint 5** - Documentos/PDF e arquivos privados (RF-10, RF-11).
- [x] **Sprint 6** - Retornos e tarefas (RF-12, RF-13). Tabelas:
      `retornos`, `tarefas`; tarefas simples, sem recorrencia, com prioridade,
      status operacional e remocao logica.
- [x] **Sprint 11** - Pagamentos basicos (RF-14, RF-15 operacional). Registro,
      consulta paginada, filtros, vinculo opcional a atendimento/orcamento,
      estorno/cancelamento administrativo e indicadores restritos ao admin.
- [x] **Sprint 12** - Estoque simples: materiais, entradas, saidas, ajustes,
      historico append-only, alertas calculados, RLS/RPC e Dashboard operacional.
- [ ] **Sprint 8** - Validade/esterilizacao (RF-17, RF-18). Schema parcial nas migrations `0007`/`0008`; UI, RLS especifica e homologacao ainda nao estao concluidos. Modulo desativado para o release candidate. Tabela:
      `controle_validade`.
- [ ] **Sprint 9** - Testes e seguranca finais (RF-20, RN-05, RNF-01,
      RNF-07). `auditoria` minima ja existe desde a Sprint 1.5; ampliar
      eventos e revisar policies de todos os modulos.
- [ ] **Sprint 10** - Orcamentos (RF-16): migration `0011`, UI, PDF e testes
      implementados; pendente de aplicacao e homologacao em ambiente ficticio.

Detalhamento completo (objetivo, dependencias, testes, criterio de
conclusao) por sprint esta na especificacao tecnica aprovada, secao 9.

## Pontos a validar antes das sprints que os afetam

Ver `docs/DECISIONS.md`. Prioridade para os que afetam modelagem de
dados: PAV-19 (limites de upload, antes da Sprint 5). A matriz de cada
modulo futuro ainda precisa ser detalhada antes de sua migration, sob a
regra deny-by-default aprovada na Sprint 1.5.
# Bloco clinico integrado

- [x] Agenda dia/semana e filtro por profissional.
- [x] Agendamento, remarcacao e estados operacionais.
- [x] Atendimento agendado/direto, evolucao e finalizacao.
- [x] Procedimentos simples sem odontograma/estoque/financeiro.
- [x] RLS/RPC/auditoria e testes locais.
- [x] Aplicar `0004` e executar suite RLS/RPC na homologacao ficticia
  (lint SQL sem erros; 23 testes de integracao aprovados).
- [ ] Homologacao manual pelo usuario apos validacao remota.
