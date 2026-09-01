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
| PAV-18 | Auditoria minima com eventos fechados por sprint; a Sprint 1.5 cobre identidade e acesso antes de qualquer dado clinico. |
| PAV-20 | MFA e obrigatorio para administrador antes do go-live; continua como gate enquanto nao estiver configurado e testado. |
| PAV-21 | Recepcao ve apenas o financeiro operacional necessario ao atendimento; indicadores agregados/gerenciais ficam restritos ao administrador. |

Pontos ainda em aberto (PAV-03 a PAV-08 e PAV-19):
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

- **Sprint 0 (infraestrutura)**: concluida.
- **Sprint 1 (autenticacao e usuarios)**: concluida.
  - Autenticacao real (Supabase Auth, sessao via cookies, proxy de
    protecao de rota) + recuperacao de senha.
  - Layout global (Sidebar/Header) adaptado do prototipo Figma Make -
    "Atendimentos" e "Configuracoes" removidos do menu por decisao
    aprovada; modulos sem rota aparecem desabilitados ("em breve"), nao
    como paginas placeholder.
  - Modulo Usuarios (RF-02) com dado real e criacao via convite
    administrativo.
  - Tabelas `usuarios` e `profissionais` criadas com RLS desde o
    inicio - ver docs/DATABASE.md e docs/SECURITY.md.
  - Build/lint originais foram posteriormente validados na Sprint 1.5.
- **Sprint 1.5 (hardening)**: validacao tecnica concluida, inclusive
  migration/RLS em homologacao isolada. Inclui Node 24, ESLint flat config,
  `proxy.ts`, callbacks SSR/PKCE, estado fail-closed de conta, onboarding/
  offboarding atomico, funcoes SQL endurecidas e auditoria minima.
- **Sprint 2 (Pacientes)**: concluida e validada em homologacao ficticia,
  com migration `0003` aditiva, cadastro/busca/ficha, alertas clinicos
  segregados, lint SQL e testes RLS/RPC por perfil.
- **Bloco clinico integrado (Agenda/Atendimento/Procedimentos)**:
  implementado em migration aditiva `0004`; lint SQL e 23 testes remotos
  de Auth/Pacientes/RLS/RPC aprovados em homologacao ficticia. Aguarda
  homologacao manual antes do fechamento funcional.
- **Sprint 13 (Servicos e consumo de estoque)**: migration `0015` adiciona
  catalogo administrativo, composicao snapshotada por procedimento e consumo
  atomico na finalizacao.
- **Sprint 14 (Odontograma FDI)**: migration aditiva `0016` preparada para
  vincular dentes permanentes a procedimentos sem migrar o campo textual
  legado e sem alterar quantidade, valor ou estoque. Aplicada na homologacao
  após migration list e dry-run alinhados; homologacao visual ainda pendente.

## Convencao estabelecida na Sprint 1 (seguir nas proximas sprints)

- Itens do menu lateral sem rota implementada ficam desabilitados com
  marcador "em breve", nunca como link morto nem pagina placeholder
  vazia.
- Nenhuma tela nova entra no menu ativo antes de ter dado real por tras -
  nao copiar dado mockado do prototipo para dar aparencia de
  funcionalidade que nao existe.
- Toda pagina/rota protegida usa requireUser()/requireAdmin() de
  lib/auth/session.ts, ALEM do proxy - nunca uma camada so.
- Toda tabela nova nasce com RLS habilitada na mesma migration que a
  cria, nunca depois.
- Operacoes que exigem a service role key (lib/supabase/admin.ts) so
  podem ser chamadas depois de uma checagem explicita de perfil no
  server action - a service role ignora RLS, entao a autorizacao vira
  responsabilidade exclusiva desse cheque.
