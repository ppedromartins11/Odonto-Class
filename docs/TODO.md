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
      homologacao ficticia. MFA/AAL2 administrativo foi concluido na Sprint
      22.1; templates e redirects do ambiente final permanecem gates externos.
- [x] **Sprint 2** - Pacientes (RF-04, RF-05, RF-06 parcial, RF-20).
      `pacientes`, `paciente_alertas_clinicos`, busca nome/telefone, ficha,
      RPCs, RLS e auditoria validados. Migration `0003`, lint SQL e 15
      testes de integracao/autorizacao passaram em homologacao ficticia.
- [x] **Bloco clinico integrado (substitui Sprints 3/4 separadas)** - Agenda,
      atendimento e procedimentos homologados manualmente.
- [x] **Sprint 5** - Documentos/PDF e arquivos privados (RF-10, RF-11).
- [x] **Padronização documental oficial** - migration `0019`, templates A4,
      autoria por atendimento, CID isolado e PDFs imutáveis/versionados.
- [x] **Sprint 6** - Retornos e tarefas (RF-12, RF-13). Tabelas:
      `retornos`, `tarefas`; tarefas simples, sem recorrencia, com prioridade,
      status operacional e remocao logica.
- [x] **Sprint 11** - Pagamentos basicos (RF-14, RF-15 operacional). Registro,
      consulta paginada, filtros, vinculo opcional a atendimento/orcamento,
      estorno/cancelamento administrativo e indicadores restritos ao admin.
- [x] **Sprint 12** - Estoque simples: materiais, entradas, saidas, ajustes,
      historico append-only, alertas calculados, RLS/RPC e Dashboard operacional.
- [x] **Sprint 13** - Catalogo de servicos, valor aplicado historico,
      composicao snapshotada e consumo automatico atomico na finalizacao.
- [x] **Sprint 14** - Odontograma FDI permanente por procedimento. Migration
      `0016`, integracao/RLS e homologacao visual aprovadas.
- [x] **Sprint 15** - Validade, lotes e esterilizacao (RF-17/RF-18).
      Migrations `0017`/`0018`, integracao/RLS, QA remoto e homologacao visual
      aprovados. FEFO clinico permanece em Sprint futura especifica.
- [ ] **Release readiness** - hardening tecnico, smoke/E2E e configuracoes
      externas de producao. A auditoria append-only, MFA/AAL2, DR ate `0029`
      e governanca inicial de logs estao documentados; SMTP, redirects,
      dominio/DNS/TLS, Vercel envs, CSP/HSTS e rate limiting continuam como
      gates externos antes de dados reais.
- [x] **Sprint 10** - Orcamentos (RF-16): migration `0011`, UI, PDF e testes
      implementados e preservados no historico de migrations.
- [x] **Sprint 22.3** - Rastreabilidade clinica lote -> procedimento:
      migration `0029`, consumo/estorno transacional, RLS/RBAC e restore
      isolado complementar validados.
- [ ] **P2 — Auditoria administrativa** - interface de consulta/exportacao e
      automacao de descarte somente apos politica formal aprovada; manter a
      tabela append-only e o procedimento manual controlado ate la.

## Evolucoes pos-MVP

- [ ] FEFO automatico para sugerir/selecionar lotes, preservando confirmacao
      humana e as validacoes transacionais atuais.
- [ ] Vinculo rastreavel entre procedimento e pacote/ciclo de esterilizacao.
- [ ] Fluxo auditado de correcao clinica apos finalizacao, sem reescrever
      historico.
- [ ] Integracoes futuras com Google e outras plataformas externas, somente
      apos revisao de escopo, privacidade e autorizacao.
- [ ] Automacoes operacionais avancadas, sem ampliar o MVP atual.
- [ ] Estados adicionais de loading/erro e refinamentos de acessibilidade onde
      a observacao de uso real indicar necessidade.
- [ ] Testes de carga, abuso, rate limiting e resiliencia no ambiente final.

Detalhamento completo (objetivo, dependencias, testes, criterio de
conclusao) por sprint esta na especificacao tecnica aprovada, secao 9.

## Pontos a validar antes das sprints que os afetam

Ver `docs/DECISIONS.md`. A matriz de cada modulo futuro deve ser detalhada
antes de sua migration, sob a regra deny-by-default aprovada na Sprint 1.5.
# Bloco clinico integrado

- [x] Agenda dia/semana e filtro por profissional.
- [x] Agendamento, remarcacao e estados operacionais.
- [x] Atendimento agendado/direto, evolucao e finalizacao.
- [x] Procedimentos simples preservados; catálogo/consumo snapshotado na Sprint
      13 e vínculo visual FDI separado na Sprint 14.
- [x] RLS/RPC/auditoria e testes locais.
- [x] Aplicar `0004` e executar suite RLS/RPC na homologacao ficticia
  (lint SQL sem erros; 23 testes de integracao aprovados).
- [x] Homologacao manual pelo usuario apos validacao remota.
