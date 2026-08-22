# Modelo de Dados

> Sprint 1.5: migrations `0001_usuarios_profissionais.sql` e
> `0002_sprint_1_5_hardening.sql`. A segunda endurece funcoes/RLS,
> provisionamento e cria `auditoria`. Ambas foram executadas e validadas
> em homologacao ficticia em 22/08/2026. As demais 13
> tabelas continuam apenas descritas neste documento, sem migration -
> serao criadas incrementalmente, sprint por sprint.

## Premissas

- Autenticacao via `auth.users` (Supabase); `public.usuarios` guarda o
  perfil de aplicacao em relacao 1:1 com `auth.users.id`.
- Perfis fixos (`administrador`, `dentista`, `recepcao`) como `ENUM`
  nesta fase.
- Nomes de tabela em portugues, snake_case.
- Tabelas ligadas a paciente usam exclusao logica; nunca `DELETE` fisico
  de prontuario (PAV-17).
- Campos de auditoria padrao: `created_at`, `updated_at`, `created_by`,
  `updated_by`.

## Tabelas (16)

`usuarios`, `profissionais`, `pacientes`, `agendamentos`, `atendimentos`,
`procedimentos`, `documentos`, `retornos`, `tarefas`, `pagamentos`,
`orcamentos`, `orcamento_itens`, `controle_validade`,
`arquivos_paciente`, `auditoria`.

Campos principais, PK/FK, constraints e indices: ver especificacao
tecnica aprovada (secao 5.2) - reproduzidos aqui de forma resumida com
os ajustes das decisoes PAV-09 a PAV-17:

- **pacientes.documento_identificacao**: nullable, sem validacao de
  formato (PAV-09).
- **pagamentos**: `atendimento_id` e `orcamento_id` nullable, com CHECK
  garantindo no maximo um dos dois preenchido (PAV-10).
- **orcamento_itens**: `descricao` texto livre + `quantidade` +
  `valor_unitario` + `valor_total`; sem FK para catalogo de
  procedimentos nesta fase (PAV-11).
- **controle_validade**: campo `categoria` (enum: material/
  esterilizacao) + `detalhes` (jsonb) para campos especificos de
  esterilizacao (lote, ciclo, responsavel tecnico) sem precisar de
  tabela separada (PAV-12).
- **agendamentos**: constraint de nao-overlap por profissional sem
  excecao de encaixe (PAV-13); a interface pode expor uma lista de
  "consultas a confirmar" para apoiar a confirmacao manual (PAV-14).
- **atendimentos.agendamento_id**: nullable - atendimento pode existir
  sem agendamento previo (PAV-15).
- **procedimentos.dente**: texto livre; convencao proposta FDI (PAV-16),
  pendente de confirmacao dos dentistas antes de uso em producao.
- **pacientes** e demais tabelas clinicas: sem exclusao fisica (PAV-17);
  usar `ativo=false`/status equivalente.
- **auditoria**: append-only - RLS deve impedir `UPDATE`/`DELETE` por
  qualquer perfil de aplicacao.

## ERD

```mermaid
erDiagram
    USUARIOS {
        uuid id PK
        text nome
        text email
        enum perfil
        enum status
    }
    PROFISSIONAIS {
        uuid id PK
        uuid usuario_id FK
        text registro_profissional
        enum status
    }
    PACIENTES {
        uuid id PK
        text nome
        date data_nascimento
        text documento_identificacao
        bool ativo
    }
    AGENDAMENTOS {
        uuid id PK
        uuid paciente_id FK
        uuid profissional_id FK
        timestamptz inicio
        timestamptz fim
        enum status
    }
    ATENDIMENTOS {
        uuid id PK
        uuid agendamento_id FK
        uuid paciente_id FK
        uuid profissional_id FK
        text evolucao
    }
    PROCEDIMENTOS {
        uuid id PK
        uuid atendimento_id FK
        text dente
        numeric valor
    }
    DOCUMENTOS {
        uuid id PK
        uuid paciente_id FK
        uuid atendimento_id FK
        enum tipo
        enum status
    }
    RETORNOS {
        uuid id PK
        uuid paciente_id FK
        uuid atendimento_origem_id FK
        date data_prevista
        enum status
    }
    TAREFAS {
        uuid id PK
        uuid responsavel_id FK
        uuid paciente_id FK
        enum status
    }
    PAGAMENTOS {
        uuid id PK
        uuid paciente_id FK
        uuid atendimento_id FK
        uuid orcamento_id FK
        numeric valor
        enum status
    }
    ORCAMENTOS {
        uuid id PK
        uuid paciente_id FK
        numeric valor_total
        enum status
    }
    ORCAMENTO_ITENS {
        uuid id PK
        uuid orcamento_id FK
        numeric valor_total
    }
    CONTROLE_VALIDADE {
        uuid id PK
        uuid responsavel_id FK
        enum categoria
        date validade
        jsonb detalhes
    }
    ARQUIVOS_PACIENTE {
        uuid id PK
        uuid paciente_id FK
        uuid usuario_id FK
        enum tipo
    }
    AUDITORIA {
        uuid id PK
        uuid usuario_id FK
        text entidade
        text evento
    }

    USUARIOS ||--o| PROFISSIONAIS : "pode ser"
    USUARIOS ||--o{ TAREFAS : responsavel
    USUARIOS ||--o{ AUDITORIA : gera
    USUARIOS ||--o{ ARQUIVOS_PACIENTE : "faz upload"
    USUARIOS ||--o{ CONTROLE_VALIDADE : responsavel
    PACIENTES ||--o{ AGENDAMENTOS : possui
    PACIENTES ||--o{ ATENDIMENTOS : possui
    PACIENTES ||--o{ DOCUMENTOS : possui
    PACIENTES ||--o{ RETORNOS : possui
    PACIENTES ||--o{ PAGAMENTOS : possui
    PACIENTES ||--o{ ORCAMENTOS : possui
    PACIENTES ||--o{ ARQUIVOS_PACIENTE : possui
    PACIENTES ||--o{ TAREFAS : "vinculo opcional"
    PROFISSIONAIS ||--o{ AGENDAMENTOS : atende
    PROFISSIONAIS ||--o{ ATENDIMENTOS : realiza
    PROFISSIONAIS ||--o{ DOCUMENTOS : emite
    AGENDAMENTOS ||--o| ATENDIMENTOS : origina
    AGENDAMENTOS ||--o{ TAREFAS : "vinculo opcional"
    ATENDIMENTOS ||--o{ PROCEDIMENTOS : contem
    ATENDIMENTOS ||--o{ DOCUMENTOS : "gera (opcional)"
    ATENDIMENTOS ||--o| RETORNOS : "origina (opcional)"
    ATENDIMENTOS ||--o{ PAGAMENTOS : "vinculo opcional"
    ORCAMENTOS ||--o{ ORCAMENTO_ITENS : contem
    ORCAMENTOS ||--o{ PAGAMENTOS : "vinculo opcional"
```

## RLS e consistencia (Sprint 1.5)

`usuarios` e `profissionais` tem RLS habilitada desde a criacao (nunca
existiu um momento em que essas tabelas ficaram sem RLS). Padrao usado:

- Funcoes `public.is_admin()` e `public.is_active_user()` (`SECURITY
  DEFINER`, `search_path = ''`) para permitir que
  policies de `usuarios` verifiquem o perfil do usuario logado sem cair
  em recursao de avaliacao de RLS (a policy nao pode consultar
  diretamente a propria tabela que ela protege).
- `usuarios`: SELECT proprio para autenticado e SELECT geral para admin.
  Sem `INSERT/UPDATE/DELETE` direto para `authenticated`; alteracao passa
  por `update_user_access()`, que protege o ultimo admin e audita.
- `profissionais`: SELECT apenas para usuario ativo. Escritas diretas de
  usuario foram revogadas; a RPC sincroniza perfil/status.
- Trigger em `auth.users` provisiona convite em uma unica transacao e
  sincroniza alteracao de e-mail. A migration recusa contas Auth
  preexistentes sem perfil para impedir saneamento silencioso.
- `auditoria`: append-only; somente admin le, usuario autenticado nao
  escreve nem altera. Indices cobrem usuario/tempo e entidade/tempo.

Ver `docs/SECURITY.md` para o racional completo.

## Proxima etapa

`0001` + `0002`, lint SQL e a suite RLS foram validados em homologacao
ficticia. A Sprint 2, quando iniciada explicitamente, cria `pacientes`
com RLS desde a criacao.
