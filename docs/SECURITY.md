# Seguranca e LGPD

Este documento e uma analise tecnica, nao um parecer juridico. Pontos
marcados como "requer validacao profissional" precisam de confirmacao
com advogado/contador especializado em regulacao de saude antes de
serem tratados como definitivos.

## Principios adotados

| Tema | Abordagem |
|---|---|
| Autenticacao | Supabase Auth (e-mail + senha); MFA para perfis administrativos ainda em aberto (PAV-20). |
| Autorizacao | Sempre verificada no backend/banco (RLS) - nunca apenas ocultando UI. |
| RBAC | Perfil gravado em `usuarios.perfil`; policies de RLS leem `auth.uid()`. |
| Isolamento de dados | RLS em toda tabela com dado clinico/pessoal. |
| Secrets | Apenas em variaveis de ambiente; nunca commitados. `.env.local` no `.gitignore`. |
| Sessoes | Gerenciadas pelo Supabase Auth (JWT + refresh token); logout explicito. |
| Logs | Nunca registrar dado clinico sensivel em logs de aplicacao/erro. |
| Auditoria | Tabela `auditoria` append-only. Lista minima de eventos criticos ainda em definicao (PAV-18) - sugestao inicial: login, alteracao de permissao, criacao/edicao/exclusao de prontuario, geracao de documento, acesso a dado de paciente por perfil nao-clinico. |
| Uploads | Buckets privados no Supabase Storage; acesso via URL assinada/temporaria. Tamanho/tipos permitidos ainda em definicao (PAV-19). |
| Backups | Backups automaticos do Postgres gerenciado; teste de restauracao obrigatorio antes de producao (RNF-07). |
| Retencao | Prontuario odontologico normalmente tem prazo minimo de retencao legal - **prazo exato requer validacao profissional**. |
| Exclusao | Exclusao logica por padrao; exclusao fisica de prontuario esta desabilitada por decisao (PAV-17) e **requer validacao profissional** antes de qualquer mudanca. |
| Exposicao de dados sensiveis | Minimizacao de campos coletados (PAV-09); segregacao entre dado administrativo e clinico onde possivel. |

## Regra transversal

Nenhum ambiente de desenvolvimento ou teste deve conter dados reais de
paciente (RN-09). Dados ficticios apenas.

## Estado na Sprint 0

Nenhuma policy de RLS foi criada ainda (nao existem tabelas definitivas
- ver `docs/DATABASE.md`). Nenhuma autenticacao foi implementada. Este
documento serve como guia para a Sprint 1 em diante.
