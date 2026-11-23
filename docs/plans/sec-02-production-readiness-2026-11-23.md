# SEC-02 — Estado de prontidão e autorizações (23/11/2026)

> Relatório de **somente leitura**, baseado no GitHub `main` (commit `6360ace`), Supabase `clinica` e Vercel Production. Não atesta homologação nem recuperação de backup. Não registrar nomes de pacientes, emails, IDs pessoais, chaves ou detalhes clínicos.

## Mudanças seguras realizadas nesta etapa

- Adicionado bloqueio de CI para arquivos `.env*` versionados fora do formato de exemplo e valores sensíveis preenchidos em templates; **nenhum valor encontrado deve ser impresso**.
- Testes sintéticos de regressão para o bloqueio, sem segredos reais.
- Nenhum SQL ou script destrutivo executado, sem mudanças de RLS/grants/Auth nem nas variáveis de Production.

## Evidências atuais (consultas count-only, sem PII)

| Gate | Evidência | Estado |
| --- | --- | --- |
| GitHub / Vercel | `main` `6360ace`, CI PASS, Vercel READY; chave server-only Sensitive configurada | PASS para build/deploy |
| Banco | versões `0001`–`0031` e `20261123133303` aplicadas; `0032`–`0034` pendentes | BLOCKED |
| Autenticação | 24 contas Auth e 24 perfis; migration `0032` é bootstrap para instalação **vazia** | `0032` NÃO aplicar cegamente |
| Segurança | 2 helpers internos de gatilho executáveis por `anon` segundo Security Advisor; `0033` contém revogações | BLOCKED |
| Documentos | `document_private`, `prepare_upload_attestation`, `create_patient_file_metadata_verified` e `create_official_document_verified` ausentes; código já os invoca | BLOCKED |
| Backup | snapshot histórico documentado, mas **restore atual não atestado**; Free sem backups automáticos diários | BLOCKED |
| Testes | 396 testes passaram, 1 ignorado no CI da main; suíte PostgreSQL de integração não executada | BLOCKED |
| Dados de testes | 12 pacientes com prefixo `HOMOLOG_`; outros vínculos financeiros e clínicos identificados | REVIEW REQUIRED |
| Dados atuais | pacientes 22, agenda 17, orçamentos 2, PDFs registrados 1, objetos privados 11 | Somente inventário, não autoriza limpeza |
| Performance | índices duplicados (3), chaves estrangeiras sem índice (83), RLS initplan (3) | REVIEW, sem modificação automática |

## Sequência segura exigida

1. **Restauração:** produzir backup atualizado + exportação de Storage para destino privado criptografado e **executar restauração** em PostgreSQL local fictício. Comparar contagens, integridade e restrições sem trazer dados reais a relatórios ou repositório. Sem esse gate não fazer DDL em Production nem excluir homologação.
2. **Conciliação do histórico:** a migration da agenda foi aplicada com versionamento `20261123133303`, embora `0032`–`0034` permaneçam fora do ledger. Planejar a ordem/histórico antes de rodar a CLI; nunca executar `supabase db push` cegamente.
3. **Migration `0032`:** revisar a funcionalidade de bootstrap inicial contra as **24 contas existentes**; a regra é para instalação vazia. Não aplicar automaticamente. Se não se aplicar, preparar decisão de skip/registro auditável com revisão.
4. **Migration `0033`:** validar revogação de `EXECUTE` em helpers internos, chamadas por triggers/owners e constraint de caminho de PDF. Exigir teste de integração e checagem de dados legados, rollback/recovery.
5. **Migration `0034`:** validar novos fluxos de atestação, arquivos e documentos em Storage privado, MFA/Auth/role, falhas de upload, cleanup e compatibilidade de itens antigos. Não executar diretamente na produção sem testes isolados.
6. **Integração:** recriar laboratório fictício (o QA antigo foi excluído), sem secrets de Production. Testar RLS negativa por perfil, MFA AAL2, concorrência, rollback, agenda, orçamento e Storage. `homologacao-ficticia` está no GitHub Actions mas não deve apontar ao banco real.
7. **Dados de homologação:** mapear todas as dependências dos registros `HOMOLOG_` e pedir aprovação específica antes de excluir qualquer registro.
8. **Outros:** branch protection com checks obrigatórios; verificação do segredo histórico revogado; revisão de índices por EXPLAIN, sem exclusões automáticas; configuração de proteção contra senhas vazadas se o plano permitir.

## Autorizações individuais necessárias

- **A1:** backup/restore privado, inclusive transferência controlada de dados sensíveis para ambiente seguro. Verificar o destino e a retenção antes de executar.
- **A2:** aplicar migration `0033` em Production, **após A1 e validação de integração**.
- **A3:** decidir o tratamento de `0032` em instalação com usuários existentes e executar a conciliação do histórico de migrations.
- **A4:** aplicar migration `0034` em Production, **após A1, A2/A3 conforme dependências, e integração**.
- **A5:** exclusão dos registros de homologação e objetos vinculados, **após inventário e backup**.
- **A6:** ativar regras de proteção de branch `main` (pode alterar o processo de merge/deploy).
- **A7:** aplicar futura RPC atômica de orçamentos ou alterações de RLS/grants adicionais (somente após projeto e testes).
- **A8:** qualquer upgrade de plano Supabase ou pagamento (sempre ação manual do titular).

## Bloqueios explícitos

Sem aprovação específica, não executar: `DELETE`, `TRUNCATE`, limpeza de Storage, `supabase db reset`, migrations em Production, troca de chaves, reescrita do histórico, alteração de regras de acesso, criação de dados fictícios em produção, deploy funcional de alterações não homologadas.

A validação CI de código não substitui autenticação, SQL real, backup/restauração e autorização do responsável.
