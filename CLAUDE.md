# CLAUDE.md - Regras do Projeto

Este arquivo e lido pelo Claude Code no inicio de cada sessao. Ele existe
para evitar que decisoes ja tomadas sejam reabertas, que requisitos sejam
presumidos, ou que o escopo mude silenciosamente.

## O que este projeto e

Sistema de gestao (MVP v1) para uma clinica odontologica real: agenda,
pacientes, prontuario/atendimento, documentos, retornos, tarefas,
pagamentos, orcamento e controle de validade/esterilizacao.

A fonte de verdade dos requisitos e `docs/REQUIREMENTS.md`. Decisoes de
arquitetura estao em `docs/ARCHITECTURE.md`, o modelo de dados em
`docs/DATABASE.md`, e as regras de seguranca/LGPD em `docs/SECURITY.md`.
Nao presuma nada que nao esteja em algum desses arquivos.

## Workflow obrigatorio (todas as sprints)

```
ANALISAR -> PLANEJAR -> IMPLEMENTAR -> TESTAR -> REVISAR -> DOCUMENTAR -> COMMITAR
```

- **ANALISAR**: leia os documentos relevantes antes de tocar em codigo.
  Se encontrar ambiguidade, PARE e liste como "PONTO A VALIDAR" em vez de
  presumir. Nao presuma requisitos.
- **PLANEJAR**: descreva o plano (tabelas, endpoints, componentes) antes
  de implementar. Aguarde aprovacao quando o escopo for grande.
- **IMPLEMENTAR**: implemente exatamente o que foi planejado e aprovado -
  nao adicione campos, telas ou funcionalidades que nao foram pedidos.
- **TESTAR**: toda funcionalidade que toca dado clinico ou financeiro
  precisa de teste de autorizacao (RN-05) alem do teste funcional.
- **REVISAR**: confira aderencia a `DATABASE.md` e `SECURITY.md` antes de
  seguir para a proxima etapa.
- **DOCUMENTAR**: atualize `docs/CHANGELOG.md` e `docs/DECISIONS.md`.
- **COMMITAR**: mensagens de commit devem referenciar o RF/RN correspondente.

Nunca pule direto para "implementar" sem passar por analisar/planejar.
Nunca implemente uma sprint inteira de uma vez sem checkpoints.

## Regras de negocio que nao podem ser violadas

- RN-02: nao pode haver conflito de horario para o mesmo profissional
  (excecao de "encaixe" fica fora do MVP - decisao PAV-13).
- RN-05: usuario sem permissao nao pode visualizar ou alterar dado
  clinico de outro perfil - verificacao sempre no backend/RLS, nunca so
  na interface.
- RN-09: dados de desenvolvimento e teste devem ser ficticios. Nunca usar
  dados reais de pacientes antes da Sprint 10 (homologacao) e apenas com
  controles de seguranca em vigor.
- Exclusao fisica de paciente/prontuario e proibida por padrao (PAV-17) -
  usar sempre exclusao logica (`ativo=false`), nunca `DELETE`.

## Decisoes ja aprovadas (nao reabrir sem pedido explicito)

| PAV | Decisao aprovada |
|---|---|
| PAV-09 | Documento de identificacao do paciente e opcional, sem validacao de formato. |
| PAV-10 | Pagamento vincula no maximo UM de: atendimento OU orcamento (nunca os dois). |
| PAV-11 | Itens do orcamento em texto livre (sem catalogo de procedimentos nesta fase). |
| PAV-12 | Validade e esterilizacao usam a mesma tabela-base (`controle_validade`), com campo `categoria` e `detalhes` (jsonb) flexivel. |
| PAV-13 | Regra de "encaixe" no conflito de horario fica fora do MVP - bloqueio e sempre rigido. |
| PAV-14 | Confirmacao de consulta e manual; sistema apenas expoe lista de consultas a confirmar. |
| PAV-15 | `atendimentos.agendamento_id` e opcional (atendimento pode existir sem agendamento previo). |
| PAV-16 | Notacao de dente proposta: FDI. Campo continua texto livre. Pendente apenas de confirmacao dos dentistas antes do preenchimento em producao. |
| PAV-17 | Sem exclusao fisica de prontuario. Prazo de retencao formal ainda depende de validacao profissional/juridica. |

Pontos ainda em aberto (RBAC detalhado, PAV-01 a PAV-08, PAV-18 a PAV-21):
ver `docs/DECISIONS.md` e `docs/REQUIREMENTS.md`. Nao resolva sozinho -
sinalize e aguarde confirmacao.

## O que NAO fazer sem pedido explicito

- Nao criar funcionalidades fora do escopo do MVP (ver `docs/REQUIREMENTS.md`,
  secao "Fora do MVP").
- Nao implementar autenticacao/RLS alem do que a sprint atual pede.
- Nao criar ou alterar migrations sem elas terem sido descritas e
  aprovadas antes.
- Nao usar dados reais de pacientes em nenhum ambiente de desenvolvimento.
- Nao commitar segredos/chaves. `.env.local` nunca deve ser versionado.
- Nao assumir versoes de dependencias que nao puderam ser validadas -
  ver `docs/DECISIONS.md` sobre o estado do `package.json` da Sprint 0.

## Convencoes

- Nomes de tabelas e campos do banco em portugues, snake_case (ver `docs/DATABASE.md`).
- Codigo (variaveis, funcoes, componentes) em ingles, seguindo convencao usual de TypeScript/React.
- Gerenciador de pacotes: npm.
- Estrutura de pastas: ver `README.md`.

## Estado atual do projeto

- **Sprint 0 (infraestrutura)**: concluida nesta etapa. Nenhuma tabela
  definitiva, nenhuma autenticacao, nenhuma funcionalidade implementada.
- **Proxima etapa**: Sprint 1 - Autenticacao e usuarios (RF-01, RF-02).
  Aguardando aprovacao explicita antes de iniciar.
