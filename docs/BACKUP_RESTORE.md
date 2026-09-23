# Backup, Restore e Disaster Recovery

Este runbook define a estrategia manual inicial de backup e recuperacao do
Odonto Class. Ele cobre restauracao tecnica; nao substitui politica do
provedor, retencao legal de prontuarios ou revisao juridica aplicavel.

## Principios obrigatorios

- Nunca restaurar sobre producao ou a homologacao de origem.
- Usar inicialmente projeto Supabase temporario ou Supabase local Docker,
  isolado e sem `link` para a origem.
- Manter dumps, copias de objetos e configuracoes temporarias fora do Git,
  em diretorio ignorado e criptografado em repouso quando houver dados que nao
  sejam estritamente ficticios.
- Nunca registrar connection strings, service-role keys, senhas, JWTs,
  cookies, QR URIs, segredos TOTP ou valores de `.env`.
- Registrar somente identificadores sanitizados, migration list, inventario de
  tabelas, policies, RPCs e contagens antes do backup.

## Cobertura e backup

| Componente | Cobertura | Observacao |
| --- | --- | --- |
| Schema e dados `public` | Dump logico oficial | Estrutura, dados e sequencias da aplicacao. |
| Auth | `auth.users` e `auth.identities` | Exclui sessoes, refresh tokens, links temporarios, fatores MFA/TOTP, desafios MFA e WebAuthn. O dump pode conter hashes de senha. |
| Storage metadata | `storage.buckets` e `storage.objects` | Nao inclui bytes fisicos. |
| Storage fisico | Copia separada por objeto privado | Usar `supabase storage cp --experimental` ou mecanismo oficial equivalente e verificar hash. |
| Configuracoes externas | Checklist manual | Nao fazem parte de `supabase db dump`. |

1. Confirmar a origem sem revelar URL, project ref completo ou credenciais.
2. Executar `supabase migration list --linked`; parar diante de divergencia.
3. Capturar contagens e metadados sanitizados.
4. Usar `supabase db dump` para schema/dados `public`, `auth.users`,
   `auth.identities` e metadata de Storage.
5. Inventariar objetos privados. Para cada objeto permitido pela politica,
   copiar bytes para backup protegido, preservando bucket/path e verificando
   SHA-256 no destino.
6. Criptografar o conjunto, manter uma copia fora do computador de origem e
   registrar somente data, escopo, tamanho e resultado sanitizado.

`supabase db dump` nao transfere bytes de Storage. Metadado restaurado nao e
evidencia de que o arquivo fisico existe.

## Restore seguro

1. Confirmar destino vazio, isolado e sem `link` para a origem.
2. Subir o destino e registrar containers/portas ou project ref somente de
   forma sanitizada.
3. Preparar extensoes exigidas pelo schema, como `btree_gist`, antes do dump
   de `public` quando o destino nao as provisionar.
4. Restaurar schema `public`; parar diante de erro de ownership, role,
   extensao ou permissao.
5. Restaurar `auth.users` e `auth.identities` antes dos dados `public` para
   preservar FKs. Recriar a partir das migrations aprovadas os triggers em
   `auth.users` que o dump de `public` nao abrange.
6. Restaurar dados `public` e metadata de Storage.
7. Restaurar bytes fisicos no bucket privado, sem URL publica, e comparar
   SHA-256 do download no destino com a copia de backup.
8. Reconciliar `supabase_migrations.schema_migrations` somente apos verificar
   o schema, com `migration repair --status applied`; nunca reaplicar SQL
   cegamente sobre o schema restaurado.
9. Validar contagens, FKs orfas, RLS, policies, grants, triggers e RPCs
   `SECURITY DEFINER` com `search_path` seguro.
10. Executar smoke da aplicacao em processo temporario apontado somente ao
    destino. Remover contas e objetos QA criados no teste.

## Auth e MFA apos DR

`auth.users` e `auth.identities` sao preservados; sessoes, refresh tokens,
fatores MFA, TOTP e WebAuthn nao sao restaurados. Todas as sessoes anteriores
devem ser consideradas invalidas. Cada usuario autentica novamente. Admin sem
fator ativo recebe enrollment oficial, cadastra um novo TOTP e conclui o
desafio para atingir AAL2. Nao existe bypass de MFA neste runbook.

Em perda total de autenticador, a clinica valida identidade pelo procedimento
externo aprovado. Operador autorizado remove o fator pela Admin API ou Console
do Supabase sem expor segredo; o proximo login volta ao enrollment. Recomenda-se
um segundo autenticador TOTP de contingencia.

## Checklist de configuracao externa

### Supabase

- [ ] Project URL, anon key e service-role secret no cofre de segredos.
- [ ] JWT/configuracao Auth correspondente ao projeto reconstruido.
- [ ] Providers Auth, Site URL e Redirect URLs de login, convite e recuperacao.
- [ ] SMTP e templates de e-mail.
- [ ] MFA, TOTP e politica AAL2 administrativa.
- [ ] Buckets privados, MIME/tamanho, policies e CORS/origins.
- [ ] Realtime, Edge Functions e secrets associados, se existirem.

### Vercel

- [ ] Variaveis Production/Preview: URL Supabase, anon key, service role,
  segredo de fluxo Auth e Site URL.
- [ ] Dominio, aliases e configuracao de runtime/build.
- [ ] Integracao com o projeto Supabase reconstruido e validacao de redirects.

### Outros

- [ ] DNS, certificados e provedor SMTP.
- [ ] OAuth providers/callbacks, integracoes externas, jobs/cron e secrets.

## RPO, RTO e retencao iniciais

Para clinica pequena: **RPO de ate 24 horas** e **RTO de ate 4 horas**. Sao
objetivos operacionais iniciais, nao SLA contratual; dependem de backup diario,
provedor disponivel, reconstrucao externa e operador treinado.

O laboratorio de 2026-09-12 confirmou bootstrap local, restore de schema,
Auth, dados, metadata e objeto fisico Storage, alem de smoke da aplicacao. As
fases nao foram cronometradas separadamente nesta primeira prova; o proximo DR
Drill deve registrar inicio/fim de cada fase para calibrar esses objetivos.

Enquanto nao houver automacao aprovada, o procedimento e manual:

- backup logico diario de banco e metadata;
- copia diaria dos objetos fisicos privados;
- retencao inicial de 30 backups diarios e 12 mensais, sujeita a validacao
  legal e de capacidade;
- copia criptografada fora da maquina de origem;
- teste trimestral de restore.

## DR Drill trimestral

1. Criar destino isolado e confirmar que nao aponta para producao/homologacao.
2. Restaurar o backup mais recente conforme este runbook.
3. Comparar contagens, integridade referencial, RLS, policies, RPCs e hashes
   de amostra Storage.
4. Executar smoke: anon bloqueado, usuario autorizado e AAL1 bloqueado em
   operacao administrativa.
5. Registrar tempos, resultados, versoes e pendencias sem segredos.
6. Remover somente fixtures QA e destruir destino temporario somente apos
   aprovacao operacional.

## Evidencia de laboratorio — 2026-09-12

Em Supabase local isolado via Docker, dumps oficiais da homologacao ficticia
restauraram schema publico, dados publicos, `auth.users`, `auth.identities` e
metadata Storage. Migrations `0001` a `0028` foram reconciliadas apos verificar
o schema, sem reexecutar migrations. Contagens e checks de orfandade
coincidiram; RLS ficou ativa nas 33 tabelas e 34 policies foram restauradas.

Para Storage fisico, um PDF minimo explicitamente ficticio em `QA_DR_STORAGE`
foi enviado e copiado pela ferramenta oficial ao destino isolado. Metadata,
download e SHA-256 origem/destino coincidiram byte a byte. O objeto QA foi
removido da origem e do destino; os 10 objetos preexistentes da origem nao
foram lidos, modificados ou removidos.

Um processo temporario da aplicacao apontou exclusivamente ao destino local.
Uma conta QA de recepcao, criada e removida no mesmo teste, autenticou e leu
Dashboard, Pacientes, Agenda, Tarefas, Orcamentos, Financeiro, Estoque,
Servicos, Validade e Esterilizacao. Dashboard anonimo recebeu redirecionamento
de protecao. Conta QA administrativa AAL1 foi rejeitada pela RPC protegida.
AAL2 local nao foi reproduzido sem novo fator real e nao houve bypass.

Configuracoes externas, autenticadores MFA existentes e sessoes antigas nao
fazem parte do dump e devem ser reconstruidos pelo checklist. A suite remota
de integracao nao foi executada nesta subetapa para evitar fixtures na origem;
isso nao representa falha do restore isolado.

Veredito: **DISASTER RECOVERY VALIDADO** para a estrategia manual documentada
e o escopo comprovado em homologacao ficticia. Nao e autorizacao automatica
para producao nem substitui DR Drill periodico.

## Evidencia complementar da migration 0029 — 2026-09-20

O laboratorio local isolado foi reconstruido pelas migrations `0001` a
`0029`. Um consumo clinico estritamente ficticio foi registrado pela RPC e um
backup logico foi restaurado em uma segunda base descartavel dentro do mesmo
ambiente Docker, sem conexao de escrita com a homologacao remota.

No destino restaurado foram confirmados: migration `0029`, tabela
`consumos_clinicos_materiais`, as RPCs
`record_clinical_material_consumption` e
`reverse_clinical_material_consumption`, RLS ativa, policy de leitura do
dentista responsavel e grants de execucao somente para `authenticated` e
`service_role` (sem `anon`/`PUBLIC`). A cadeia procedimento -> snapshot
previsto -> material -> lote -> movimentacao de estoque -> movimentacao de
lote permaneceu integra, sem FKs orfas.

O restore precisa preservar ACLs: uma tentativa diagnostica com
`--no-privileges` recriou o schema, mas deliberadamente nao serviu como prova
de grants. A prova valida restaurou pre-data, data e post-data com ownership
removido, mas manteve privilegios. A fixture complementar foi removida ao
reconstruir o laboratorio no baseline; nenhum dado ou dump foi versionado.
