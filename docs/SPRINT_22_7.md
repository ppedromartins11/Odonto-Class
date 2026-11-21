# Sprint 22.7 — correção dos HIGHs da auditoria

Base: `1312795`. Escopo: H01, H02, H03, H04-A/B/C, H05 e H06.
Sem correções de MEDIUM, commit, push ou aplicação remota nesta etapa.

## 0030 — autorização e provisionamento

- `get_document_download_path(uuid)` autoriza o binário pela sessão solicitante.
  Dentista autor acessa seus documentos. Admin/recepção acessam apenas declarações
  factuais sem CID. Atestados e declarações genéricas legadas ficam restritos ao
  autor. Metadata administrativa permanece visível.
- A rota só usa Storage privilegiado após a RPC autorizar o path. Negação/erro:
  404 vazio, sem SQL, CID ou path. Bucket privado; URL assinada de 300 segundos,
  não persistida; resposta `private, no-store`.
- `update_appointment` preserva paciente/profissional do atendimento iniciado.
  `start_attendance` reconfere paciente, autoria e dentista ativo antes de devolver
  atendimento existente. Ambas serializam pelo lock do agendamento.
- Todos os overloads de `update_budget_status` perdem EXECUTE de PUBLIC, anon,
  authenticated e service_role. Nenhum consumidor legítimo atual foi encontrado.
- `register_stock_movement` exige AAL2 somente para ajuste. Entradas/saídas mantêm
  RBAC. `cancel_treatment_plan` exige administrador ativo e AAL2.
- `auditoria_select_admin` exige `is_admin()` e claim oficial `aal2`.
- `convites_provisionamento`: RLS, sem acesso direto de clientes. Service role
  pode consultar/remover para manutenção, mas não inserir/atualizar.
- `prepare_user_invitation`: admin ativo AAL2, e-mail normalizado, nome e enum de
  perfil validados, `created_by=auth.uid()`, token aleatório de 256 bits, apenas
  SHA-256 persistido, expiração em 30 minutos. Renovar convite pendente invalida
  o token anterior. `revoke_user_invitation` remove somente autorização pendente
  criada pelo próprio ator.
- `handle_new_auth_user`: token/e-mail correspondentes, prazo válido, uso único e
  autor ainda administrador ativo. Perfil/nome/autor vêm da tabela, nunca da
  metadata do usuário. Trigger AFTER INSERT preservado; consumo, perfil,
  profissional e auditoria transacionais. Token removido da metadata Auth após
  consumo; UPDATE de metadata não provisiona perfis.

O SDK instalado não aceita `app_metadata` em `inviteUserByEmail`; `createUser`
aceita, mas não envia convite. Preservado `inviteUserByEmail`, precedido da RPC
AAL2. O Auth define `invited_at` depois do INSERT; a prova no trigger é o token
secreto vinculado ao e-mail. Conhecer e-mail ou UUID de administrador não basta.

Falha de envio revoga somente autorização pendente. Se o Auth já consumiu o
convite, a compensação não desfaz nem reabre a conta. Contas existentes e
`update_user_profile` permanecem no fluxo atual. Nenhum bypass de bootstrap foi
criado: instalações novas precisam de bootstrap administrativo controlado,
separado do signup público.

## 0031 — consistência de lotes

- Wrapper AAL2 da 0028 preservado. A implementação interna rejeita ativação quando
  existe consumo não estornado, sem lote, em atendimento em andamento:
  `23514 / LOT_CONTROL_PENDING_REVERSIBLE_CONSUMPTION`.
- Histórico finalizado não impede ativação; seu estorno já é proibido pelo domínio.
- Estorno de consumo originalmente sem lote em material agora controlado retorna
  `23514 / LOT_CONTROL_LEGACY_REVERSAL_DENIED` antes de qualquer movimentação.
- Lock de material serializa consumo/estorno/transição. A transição não toma locks
  de atendimento na ordem inversa dos fluxos clínicos.
- `assert_lot_stock_balance` preservado, inclusive na configuração idempotente.
  Nenhum lote histórico inventado ou divergência corrigida silenciosamente.
- Actions de agenda, validade e consumo traduzem as novas rejeições em mensagens
  de domínio, sem SQL ou conteúdo clínico no erro.

## Validação local e testes

Antes das alterações: HEAD `1312795`, worktree limpo, 31/31 unitários direcionados
e 32/32 integrações direcionadas. As 32 integrações também passaram num Supabase
local novo, com 0001–0029, antes das correções.

Laboratório temporário fora do repositório, sem vínculo remoto, API/banco em
loopback e dados fictícios. TOTP habilitado apenas nesse laboratório para sessões
reais AAL1/AAL2. Signup local habilitado para testes adversariais. Nenhuma
configuração Auth remota alterada. 0030/0031 aplicadas localmente; catálogo,
grants, policy, trigger e RLS inspecionados.

`tests/integration/release-highs.authorization.test.ts` contém 11 cenários:

1. PDF real com/sem CID, autorização SQL, bucket privado, bloqueio de assinatura
   direta pelo cliente e HTTP/binário quando informada a aplicação local.
2. Reatribuição antes/depois do início, edição legítima, isolamento de B e defesa
   contra vínculo histórico inconsistente, sem evolução no erro.
3. Grants de todos overloads legados; transições proibidas e fluxo atual legítimo.
4. AAL1/AAL2 reais nos três casos; dentista/recepção/inativo/anon sem auditoria;
   entradas/saídas compartilhadas preservadas.
5. Signup forjado para os três perfis, inclusive e-mail de convite pendente sem
   token; AAL1, não-admin e inativo não autorizam provisionamento.
6. Convites dos três perfis ignoram metadata forjada; token consumido não cria
   outra conta nem reexecuta no mesmo e-mail.
7. Expiração, revogação, rotação e concorrência do convite.
8. `inviteUserByEmail` real e tentativa de promoção por `updateUser`.
9. Consumo aberto bloqueia ativação; estorno libera; consumo/estorno normal por
   lote, igualdade de saldos e configuração idempotente.
10. Histórico finalizado permite ativação mas não estorno; estado legado não
    permite atualizar apenas o agregado.
11. Consumo/ativação e estorno/ativação concorrentes com assert de balanço.

A suíte adversarial exige API e banco em loopback; é ignorada no remoto.
Nunca habilitar signup remoto para executá-la. `SUPABASE_TEST_APP_URL` deve
apontar a app local compilada com o mesmo Supabase do teste.

Fixtures existentes agora usam convite autorizado. Bootstrap da suíte:
`SUPABASE_TEST_ADMIN_EMAIL/PASSWORD`, conta reservada cujo nome começa com `QA_`
ou `HOMOLOG_`. Um fator TOTP efêmero é cadastrado/removido só nessa conta QA.
O seed usa o mesmo fluxo. `pg`/`@types/pg` são dependências de desenvolvimento
para catálogo, estados QA transacionais e saldo; não entram no runtime do produto.

### Reexecução local

1. Usar Supabase descartável sem vínculo remoto. Aplicar 0001–0029 e preparar
   administrador fictício de bootstrap por procedimento local confiável. Habilitar
   TOTP no laboratório antes dos testes.
2. Copiar 0030/0031 para o laboratório; executar
   `supabase migration up --local --workdir <laboratorio>` e conferir versões.
3. Definir variáveis de `.env.test.example` no processo, sem substituir `.env`
   real ou imprimir chaves. Variáveis do processo têm precedência no Vite.
4. Executar `npm run lint`, `npm run typecheck`, `npm run test` e
   `npm run test:integration -- --pool=threads`.
5. Com variáveis da app apontando ao mesmo laboratório, executar `npm run build`
   e `npm run start -- --port 3227`.
6. Definir `SUPABASE_TEST_APP_URL=http://localhost:3227` e executar
   `npm run test:integration -- --pool=threads tests/integration/release-highs.authorization.test.ts`.
7. Executar `npm audit --omit=dev`, `git diff --check`, conferir cleanup de Auth,
   MFA, Storage e registros QA; encerrar servidor temporário.

## Homologação remota proposta — não executada

1. Revisar diff e migrations; confirmar 0001–0029 intactas e catálogo esperado.
2. **Gate manual obrigatório antes do próximo deploy: DESABILITAR SIGNUP PÚBLICO
   no Supabase Auth.** Verificar `disable_signup=true` pelo endpoint de settings;
   preservar confirmação de e-mail. Esta Sprint não altera a configuração remota.
3. Conferir backup/restore e consultar em read-only vínculos divergentes entre
   agenda/atendimento, materiais controlados com agregado diferente dos lotes e
   contas administrativas inesperadas. As migrations não remedeiam dados antigos;
   se encontrados, interromper e aprovar remediação específica.
4. Só após autorização para aplicação remota: migration list e dry-run no projeto
   fictício confirmado; plano deve conter somente 0030/0031. Aplicar nessa ordem,
   cada uma transacional. Nenhum reset remoto.
5. Coordenar app e 0030: convite antigo falha após a migration; código novo antes
   dela falha fechado. Não liberar download antigo durante a janela de atualização.
6. Inspecionar `pg_proc`, `proacl`, `has_function_privilege`, `pg_policies`, RLS de
   convites e `on_auth_user_created`. RPC legada sem EXECUTE; helpers de convite/
   download restritos; implementação interna de lote não exposta ao cliente.
7. Criar só fixtures QA. Repetir H01–H04/H06 funcionalmente com sessões reais,
   inclusive AAL1/AAL2. H05 adversarial fica local. Validar convite legítimo pela
   interface, recebimento/aceite, perfil e CRO.
8. Rodar integrações existentes com bootstrap QA reservado e MFA disponível;
   smoke por perfil, mensagens de domínio, PDF clínico negado a admin/recepção
   e declaração administrativa permitida.
9. Remover só fixtures dessa execução; verificar resíduos; registrar versões,
   resultados e gates. Então revisar aprovação de commit. Push fora desta etapa.

Não restaurar permissões vulneráveis nem editar migrations históricas como
rollback. Falha exige manter fluxos afetados indisponíveis e preparar correção
aditiva revisada. URLs clínicas anteriores permanecem válidas até o TTL original
de 300 segundos; considerar essa janela antes de liberar acesso.

## Resultados da execu??o

- Lint: aprovado, sem warnings ap?s revis?o.
- Typecheck: aprovado.
- Unit?rios: 91/91.
- Integra??o completa local: 113/113, incluindo HTTP/PDF.
- Direcionados HIGH com HTTP: 11/11.
- Build Next.js 16.3.3: aprovado.
- npm audit --omit=dev: zero vulnerabilidades.
- git diff --check: aprovado.
- 29 migrations hist?ricas comparadas byte a byte com HEAD: intactas.
- Busca de segredos no diff e arquivos novos: nenhum JWT, token de servi?o ou URI
  autenticada encontrado; nenhum .env real/dump/artefato QA adicionado.
- Cleanup final: zero usu?rios Auth (bootstrap tamb?m removido), pacientes, documentos,
  materiais, convites, objetos Storage, auditoria QA e fatores MFA.

Aplica??o final adicional: laborat?rio voltou a 0029, recebeu bootstrap QA e os
arquivos finais 0030/0031 via CLI local. SQL lint de public retornou zero erros;
os 11 testes HIGH com HTTP passaram novamente. Remoto conferido por leitura:
?ltima migration 0029, tabela de convites ausente, signup ainda habilitado e
confirma??o de e-mail exigida. O gate manual permanece pendente.
