# Deploy

## Release candidate atual

O release candidate inclui Auth, Usuarios, Dashboard, Pacientes, Agenda,
Atendimentos, Procedimentos, Retornos, Tarefas, Documentos/PDF, Arquivos
privados, Orcamentos, Financeiro basico (pagamentos), Estoque e catalogo de
Servicos. Validade/Esterilizacao continua parcial, desativada no menu e fora
da homologacao operacional.

As migrations `0001`-`0015` fazem parte do historico local e da homologacao
ficticia. Migrations aplicadas nunca sao reescritas; qualquer divergencia deve
ser investigada antes de um deploy, sem reset ou reaplicacao de SQL historico.

### Checklist de deploy para homologacao online

1. Versionar apenas o conjunto revisado do release candidate; confirmar que
   `.env*` com credenciais, artefatos temporarios e dados ficticios nao entram
   no commit.
2. Na Vercel, configurar sem registrar valores em documentacao ou Git:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_FLOW_COOKIE_SECRET` e
   `NEXT_PUBLIC_SITE_URL`.
3. Usar um projeto Supabase exclusivo de homologacao, aplicar somente as
   migrations aprovadas para o release e manter RLS habilitada em todas as
   tabelas expostas.
4. Confirmar que o bucket de arquivos e privado, sem URL publica permanente,
   e que os downloads continuam passando pela rota server-side autorizada com
   URL assinada temporaria.
5. Em Supabase Auth > URL Configuration, cadastrar o dominio de homologacao
   e os redirects `https://<dominio>/auth/callback` e
   `https://<dominio>/auth/confirm`; repetir a validacao para recuperacao de
   senha e convite.
6. Executar no ambiente de build de producao: `npm run lint`,
   `npm run typecheck`, `npm run test` e `npm run build`; depois fazer smoke
   test com dados estritamente ficticios.

Antes de qualquer dado real ou producao: habilitar MFA para administradores,
definir e testar backup/restauracao, revisar a seguranca final e concluir o
bloco parcial de Financeiro/Orcamentos/Validade.

## Gate da Sprint 1.5

Dependencias, lint, tipos, testes unitarios, build, migrations, lint SQL
e RLS foram validados com Node.js 24 e Supabase de homologacao ficticia.
Producao permanece bloqueada pelos gates manuais de e-mail/redirects,
MFA administrativo, backup/restauracao e configuracao de ambiente.

## Checklist para concluir a Sprint 0 (fora deste ambiente)

1. **Instalar dependencias e validar o build:**
   ```
   npm install
   npm run dev
   ```
   Abrir `http://localhost:3000` e confirmar que a pagina placeholder
   aparece sem erros. Rodar tambem `npm run lint` e `npm run build`.

2. **Criar o repositorio remoto** (GitHub, ou outro host de sua
   preferencia - o workflow de CI atual assume GitHub Actions):
   ```
   git remote add origin <url-do-seu-repositorio>
   git push -u origin main
   ```

3. **Criar o projeto no Supabase** (supabase.com) e copiar, em
   Project Settings > API: URL, anon key e service role key.

3.1. **Rodar as migrations `0001` e `0002`, em ordem**, primeiro em
   homologacao. `0002` falha deliberadamente se encontrar conta Auth sem
   perfil; saneie essa inconsistencia sem inventar perfil e tente de novo.

3.2. **Configurar Auth > URL Configuration e templates**:
   permitir `<sua-url>/auth/callback` e `<sua-url>/auth/confirm`.
   O template de convite deve apontar `token_hash`/`type=invite` para
   `/auth/confirm`; recuperacao usa `ConfirmationURL` e retorna ao
   callback PKCE informado pela aplicacao.

3.3. **Criar o primeiro usuário administrador manualmente** (Auth > Users
   no painel, "Invite user", depois inserir a linha correspondente na
   tabela `usuarios` com `perfil = 'administrador'`). Não há
   autocadastro - o primeiro admin precisa existir antes de qualquer
   convite pela própria aplicação.

4. **Preencher `.env.local`** (nunca commitar este arquivo):
   ```
   cp .env.local.example .env.local
   ```
   e colar os valores copiados no passo 3, alem de
   `NEXT_PUBLIC_SITE_URL=http://localhost:3000` e um
   `AUTH_FLOW_COOKIE_SECRET` aleatorio de no minimo 32 caracteres.

5. **Conectar o repositorio na Vercel** (Import Project, apontando para
   o repositorio criado no passo 2) e adicionar as mesmas variaveis de
   ambiente do passo 4 nas configuracoes do projeto na Vercel. A
   importacao ja dispara automaticamente o primeiro deploy - isso e o
   "deploy vazio de teste" da Sprint 0. Nao e necessario usar a CLI da
   Vercel para isso.

6. Confirmar que a URL publica gerada pela Vercel mostra a mesma pagina
   placeholder validada no passo 1.

7. Em homologacao, preencher `.env.test.local` a partir de
   `.env.test.example`, aplicar/lintar as migrations pela URI Postgres e
   executar `npm run test:integration`.

8. Antes do go-live, configurar e testar MFA/AAL2 para todo
   administrador. Enquanto isso nao ocorrer, producao nao esta aprovada.

## Gate de banco da Sprint 15

Antes de liberar as rotas de Validade/Esterilizacao no ambiente remoto:

1. `migration list --linked` deve mostrar `0001`-`0016` alinhadas.
2. `db push --linked --dry-run` deve listar somente `0017_validade_esterilizacao.sql`.
3. Aplicar exclusivamente a `0017`; depois confirmar `0001`-`0017` alinhadas
   e que somente `0018_esterilizacao_equipamentos_edicao.sql` esta pendente.
4. Aplicar exclusivamente a `0018`; depois repetir listagem e dry-run ate o
   remoto ficar atualizado.
5. Executar a suite `QA_VLD_`/`QA_STER_` somente na homologacao ficticia e
   confirmar cleanup antes de qualquer uso operacional.

Nao manipular `schema_migrations` manualmente nem improvisar autenticacao se o
token do CLI nao estiver disponivel.

## Gate da migration 0019

1. Confirmar `.env.local` e `.env.test.local` no mesmo projeto fictício sem
   imprimir URL, project-ref ou credenciais.
2. `migration list --linked`: `0001`–`0018` alinhadas.
3. `db push --linked --dry-run`: somente `0019_documentos_oficiais.sql`.
4. Aplicar exclusivamente a `0019`; repetir listagem e dry-run até “Remote
   database is up to date”.
5. Executar `QA_DOC_`, confirmar cleanup de tabelas e bucket, e só então abrir
   a homologação visual dos quatro PDFs.

## Backup e recuperacao (RNF-07)

A definir formalmente quando o banco definitivo existir (Sprint 1 em
diante): a politica de backup do plano Supabase escolhido deve ser
revisada e um teste de restauracao deve ser feito antes de qualquer uso
com dados reais.

## Estado na Sprint 0

Nenhum deploy real foi realizado a partir deste ambiente. O checklist
acima e o unico caminho para concluir esse item.
