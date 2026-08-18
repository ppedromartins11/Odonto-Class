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

WhatsApp automatico, aplicativo proprio, odontograma avancado, estoque
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
