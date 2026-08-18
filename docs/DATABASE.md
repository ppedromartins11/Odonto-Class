# Modelo de Dados

> Sprint 0: este documento descreve o modelo aprovado. **Nenhuma
> migration foi criada ainda** - isso e trabalho da Sprint 1 em diante,
> tabela por tabela, conforme cada modulo for implementado.

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

## Proxima etapa

Migrations reais comecam na Sprint 1 (tabelas `usuarios`/`profissionais`
para autenticacao) e seguem incrementalmente por sprint, nunca todas de
uma vez.
