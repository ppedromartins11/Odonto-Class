# Requisitos - MVP v1

Fonte: `Documento_Requisitos_MVP_v1_Clinica_Odontologica.docx` (v1.0) +
especificacao tecnica aprovada. Este arquivo e a versao viva dos
requisitos funcionais para consulta durante o desenvolvimento.

## Contexto

Clinica com 4 dentistas + 1 recepcionista, 11-30 pacientes/semana.
Operacao atual: Google Agenda + WhatsApp + papel. Dores principais:
historico disperso, agenda fragmentada, retornos e tarefas dependentes
de memoria/manual, documentos preenchidos repetidamente.

## Requisitos funcionais (RF-01 a RF-20)

| ID | Requisito | Prioridade |
|---|---|---|
| RF-01 | Autenticacao e sessao | P0 |
| RF-02 | Usuarios e perfis | P0 |
| RF-03 | Dashboard diario | P0 |
| RF-04 | Cadastro de pacientes | P0 |
| RF-05 | Busca de paciente | P0 |
| RF-06 | Visao 360 do paciente | P0 |
| RF-07 | Agenda (agendar/remarcar/cancelar/confirmar/faltou) | P0 |
| RF-08 | Consulta ligada ao paciente | P0 |
| RF-09 | Atendimento/evolucao | P0 |
| RF-10 | Documentos (atestado/declaracao) | P0 |
| RF-11 | PDF e armazenamento | P0 |
| RF-12 | Retorno | P0 |
| RF-13 | Tarefas | P0 |
| RF-14 | Pagamentos basicos | P0 |
| RF-15 | Indicadores financeiros basicos | P1 |
| RF-16 | Orcamento simples | P1 |
| RF-17 | Controle de validade | P1 |
| RF-18 | Controle basico de esterilizacao | P1 |
| RF-19 | Arquivos/fotos | P1 |
| RF-20 | Auditoria | P1 |

## Recorte implementado na Sprint 2

- **RF-04**: cadastro, edicao administrativa, ficha e inativacao logica
  de paciente. Nome obrigatorio; data de nascimento, telefone de contato
  e documento de identificacao opcionais.
- **RF-05**: busca server-side paginada por nome (sem diferenciar acento/
  caixa) e telefone normalizado para comparacao.
- **RF-06 parcial**: ficha-base com dados administrativos e retrato atual
  de alergias, intolerancias e medicamentos para dentista ativo. Historico
  clinico, consultas e demais relacionamentos dependem das proximas etapas.
- **RF-20 incremental**: mutacoes do modulo Pacientes entram na auditoria;
  buscas e aberturas de ficha nao sao auditadas nesta fase.

Nao fazem parte deste recorte: observacoes genericas, anamnese, prontuario,
deduplicacao automatica e busca por documento.

## Bloco clinico integrado - Agenda, Atendimento e Procedimentos

- **RF-07/RF-08**: agenda diaria/semanal por profissional; criar, editar,
  remarcar, confirmar, cancelar e registrar falta. `agendamentos` representa
  o unico evento operacional, sem duplicacao artificial de consulta.
- **RN-02**: sobreposicao para o mesmo profissional e bloqueada no banco,
  inclusive sob concorrencia. Nao existe encaixe excepcional (PAV-13).
- **RF-09**: dentista ativo inicia atendimento proprio a partir da agenda ou
  diretamente a partir do paciente (PAV-15), registra evolucao e finaliza.
  Finalizar marca o agendamento relacionado como atendido na mesma transacao.
- **Procedimentos**: descricao obrigatoria e campos opcionais de dente/regiao,
  material, cor e detalhes minimos. A Sprint 13 permite opcionalmente selecionar
  um servico de catalogo com valor e consumo snapshotados. A Sprint 14 adiciona
  seleção visual dos dentes permanentes FDI por procedimento, sem interpretar
  ou remover a região textual histórica. Cobrança automática continua fora.
- **RF-20 incremental**: eventos operacionais e clinicos sao auditados apenas
  por IDs, estados e nomes de campos; evolucao e detalhes clinicos nunca sao
  copiados para `auditoria`.

Matriz vigente: administrador/recepcao operam a agenda geral; dentista ve
somente a propria agenda e somente os proprios atendimentos/procedimentos.
Administrador puro e recepcao nao recebem conteudo clinico.

## Bloco operacional - Retornos, Tarefas, Documentos e Arquivos

- **RF-10/RF-11**: atestado e declaracao gerados no servidor como PDF e gravados no historico do paciente; sem HTML arbitrario nem URL publica persistida.
- **RF-12**: dentista cria retorno do atendimento proprio; recepcao/admin vinculam o novo agendamento e o retorno e concluido quando a consulta vinculada e atendida.
- **RF-13**: tarefas simples com titulo, prazo, responsavel e vinculos opcionais, sem recorrencia ou kanban.
- **RF-19**: arquivos privados PDF/JPEG/PNG ate 10 MiB, com categoria administrativa/clinica, path UUID e acesso autorizado por perfil/vinculo.

## Sprint 10 - Orcamentos

- **RF-16**: orcamento comercial com paciente, profissional responsavel,
  validade, observacao administrativa e itens de texto livre. Valores sao
  calculados em centavos no banco.
- Status simples: rascunho, enviado, aprovado, rejeitado, expirado e
  convertido. Aprovado bloqueia alteracao de valores; convertido nao cria
  automaticamente tratamento, atendimento ou pagamento.
- O PDF e gerado sob demanda no servidor e a ficha 360 mostra somente os
  orcamentos autorizados pelo perfil autenticado.

Regras de negocio (RN-01 a RN-10) e requisitos nao-funcionais (RNF-01 a
RNF-10) do documento-fonte aplicam-se integralmente. Destaques:

- RN-02: sem conflito de horario para o mesmo profissional (excecao de
  encaixe fica fora do MVP - PAV-13).
- RN-05: isolamento de dados por perfil, sempre verificado no backend.
- RN-09: nunca usar dados reais de paciente em desenvolvimento/teste.
- RNF-01: autorizacao sempre no backend, nunca so na UI.
- RNF-03/04: volume baixo (5 usuarios, 11-30 pacientes/semana) - nao
  justifica arquitetura distribuida.
- RNF-07: backup e restauracao devem ser testados antes de producao.

## Fora do MVP (ver `docs/DECISIONS.md` para justificativa completa)

WhatsApp automatico, aplicativo proprio, odontograma avancado por faces,
condicoes/diagnostico odontologico, odontograma infantil, estoque
completo, financeiro completo (parcelamento/contas a receber detalhado),
integracao avancada com Google Calendar, anamnese digital, assinatura
digital avancada, relatorios avancados/IA, multiunidade/multitenant.

## Perfis de usuario (proposta, pendente de validacao final)

Administrador/Proprietario, Dentista, Recepcao. RBAC detalhado em
`docs/DATABASE.md` (secao RLS) e ainda tratado como hipotese - ver
PAV-01/PAV-02 em `docs/DECISIONS.md`.

## Pontos a validar (PAV) que afetam requisitos

Lista completa e atualizada em `docs/DECISIONS.md`. Os que ja foram
resolvidos (PAV-09 a PAV-17) estao registrados como decisao aprovada em
`CLAUDE.md`. Os que permanecem abertos (PAV-01 a PAV-08, PAV-18 a
PAV-21) devem ser confirmados com a clinica antes das sprints que os
afetam.
