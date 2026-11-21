# Recuperação administrativa controlada do QA — preparação local

**Estado:** preparação, sem autorização de escrita remota. **Destino único futuro:**
Supabase QA `zxvpyxvhymuibaxgxetf`. Production `sqouddqzpmkofenyufuj` e DR
`qprzxkolbbnqfopamfhj` permanecem sem mutação. Este plano não integra release,
deploy nem a sequência `supabase/migrations/`.

## Objetivo e critérios de aceite

Criar, apenas após aprovação específica, uma identidade própria para
`ppedro.dev@hotmail.com` com perfil `administrador` ativo no QA, convite por
e-mail, senha definida pelo titular e MFA/AAL2 antes de operações administrativas.
O resultado só será concluído após Auth, perfil, auditoria, aceite do convite,
login, sessão SSR, MFA, dashboard, RBAC e logout verificados. O nome de exibição
e a identidade do operador precisam ser definidos no ato da aprovação.

## Alternativa normal primeiro

`app/esqueci-senha/actions.ts` usa `resetPasswordForEmail`, o callback SSR
estabelece a sessão de recuperação e `app/redefinir-senha/actions.ts` permite ao
titular definir a senha. Isso recupera **somente uma identidade existente**. Um
dos dois administradores QA pode seguir esse fluxo legitimamente se controlar
sua caixa postal; se ainda tiver o TOTP, ou um segundo fator, entra em AAL2 e
usa o convite normal em `app/(app)/usuarios/actions.ts`. A disponibilidade da
caixa postal e do fator não está comprovada. A recuperação de fator documentada
em `docs/SECURITY.md` exige validação externa e ação de operador; nesta etapa
está excluída pela restrição `NO EXISTING USER RESET`. Não iniciar reset, envio
de e-mail, remoção de fator ou tentativa de login dos cinco usuários existentes.

## Estado e fronteiras comprovados

- Consulta read-only anterior confirmou QA ativo, 5 identidades, 5 perfis,
  2 administradores ativos, migrations 0001–0033 e ausência da conta alvo.
- 0030 cria `public.convites_provisionamento` e `prepare_user_invitation`, que
  exige admin AAL2 e grava `created_by=auth.uid()`.
- 0032 preserva `on_auth_user_created` e o constraint trigger diferido de perfil.
  O bootstrap inicial exige Auth/perfis/convites vazios e não é aplicável.
- 0031 trata lotes; 0033 fecha helpers internos. Nenhuma delas cria recuperação
  de segundo administrador. O arquivo local 0034 não integra este procedimento.
- Worktree estava amplamente modificado antes desta tarefa. Somente os arquivos
  deste plano e de `scripts/homologacao/qa-admin-recovery/` são próprios dela.

## Design excepcional QA-only

`install.sql` deve ser instalado manualmente **pelo comando controlado**
`authorize-invite.mjs`, após aprovar esta operação concreta. O script prova a
identidade do operador com um token de Management API limitado ao QA (GET
`/v1/profile`), sua capacidade de ler o projeto QA (GET `/v1/projects/{ref}`),
e compara o ID da conta com o ID nomeado na aprovação. Confere hostname ou
usuário do banco com o ref QA, TLS `verify-full`, CA confiável, chave `service_role`
funcional apenas na URL Auth QA, igualdade dos IDs Auth entre API e PostgreSQL,
inventário esperado, três triggers habilitados e fingerprint do trigger 0032.
Exige console interativo e confirmação textual. Esses controles provam
posse de credenciais do operador e vinculação ao projeto; a **autoridade para
essa exceção** vem da aprovação explícita do proprietário, com referência
registrada. Não inferir autoridade apenas de acesso técnico.

A instalação roda em uma transação e cria `qa_admin_recovery.authorization`
privada, singleton, RLS sem policies nem grants a roles de API, e
`qa_admin_recovery.audit` privada. `public.handle_new_auth_user()` é substituída
por versão que mantém os ramos normais da 0032 e acrescenta um ramo restrito a
uma autorização de recuperação. O trigger nunca é desativado. Apenas a conexão
privilegiada insere a autorização. O script gera 32 bytes aleatórios, guarda
somente SHA-256 do token, e limita a autorização a e-mail/nome aprovados,
15 minutos e um operador/approval ref. O CHECK SQL fixa literalmente o e-mail
alvo; o teste local substitui só esse literal em memória por e-mail fictício.
Ele envia convite pela Auth Admin API
com token em `user_metadata`, que o trigger consome sob `FOR UPDATE` no mesmo
COMMIT de Auth, perfil e auditoria. O token é removido do Auth ao consumir.
Nenhum campo `created_by` de administrador existente é preenchido ou simulado;
o evento `qa_admin_recovery_consumed` fica na auditoria privada com ID real do
operador Supabase e referência da aprovação. A tabela pública `auditoria` tem
enum/check fechado e permanece intacta.

`close.mjs --close --execute` revalida operador, projeto, vínculo Auth/banco e
identidade da autorização antes de executar `close.sql`. A versão original da função 0032 é
restaurada em transação e a tabela de autorização e seu trigger são removidos.
A auditoria privada permanece. `close.sql` bloqueia resposta Auth ainda
ambígua com autorização não expirada, perfil/auditoria incompletos e função
inesperada; confere também o fingerprint da função restaurada. Assim não resta
ramo excepcional ativo após o fechamento.

## Runbook remoto proposto — ainda NÃO autorizado

1. Registrar aprovação explícita para **instalar o ramo QA-only, autorizar um
   único convite, chamar `inviteUserByEmail` para o alvo e fechar o ramo após
   reconciliação**, nome de exibição, ID do operador Supabase e referência
   única da aprovação. Confirmar que a recuperação normal não está disponível.
2. Revalidar projeto via Management API, migrations, contagens, função/triggers,
   ausência de Auth/perfil/convite do alvo e ausência de outro incidente ativo.
   Preparar uma janela de execução curta e confirmar entrega de e-mail, template
   de convite e Redirect URL local `/auth/confirm` na allowlist QA.
3. Fornecer ao processo, por canal protegido e sem imprimir valores,
   `QA_RECOVERY_DB_URL` (SSL verify-full), `QA_RECOVERY_DB_CA_FILE`,
   `QA_RECOVERY_SERVICE_KEY`, `QA_RECOVERY_MANAGEMENT_TOKEN` scoped ao QA,
   `QA_RECOVERY_APPROVED_OPERATOR_ID`, `QA_RECOVERY_APPROVAL_REF`,
   `QA_RECOVERY_DISPLAY_NAME` e `QA_RECOVERY_REDIRECT_URL`. Não gravar em Git,
   logs ou relatório. Rodar `node scripts/homologacao/qa-admin-recovery/authorize-invite.mjs --execute`
   em terminal privado; não agendar nem integrar a deploy/CI.
4. Se houver erro Auth ou timeout, **não repetir**. Fazer leitura do Auth, perfil,
   autorização e auditoria pelo alvo, sem revelar token. Se a identidade foi
   criada, continuar verificações. Se não, aguardar expiração e fechar o ramo;
   não apagar usuários existentes. Uma falha antes do convite pode deixar a
   instalação pendente, que deve ser fechada com o mesmo procedimento.
5. Quando a identidade/perfil/auditoria estiverem completos, rodar o fechamento
   controlado. Se o convite falhar e a autorização expirar sem Auth, também
   fechar e registrar o resultado. Não remover a trilha `qa_admin_recovery.audit`.
6. O titular abre **somente o e-mail QA**, usa o callback SSR de convite,
   define senha própria, faz login e cadastra/verifica TOTP. Conferir sessão
   SSR, `administrador`/`ativo`, AAL2, dashboard, RPCs administrativas e RBAC,
   logout e novo login. Não afirmar sucesso antes do acesso funcional.

## Falhas, reversão e riscos

- Erro na instalação SQL: transação reverte integralmente; nada de Auth muda.
- Erro antes do convite: autorização pode permanecer até expirar; leitura e
  fechamento controlado. Nunca registrar ou reutilizar token bruto.
- Timeout no convite: pode haver COMMIT Auth apesar do erro de transporte;
  reconciliar antes de qualquer ação. O trigger e seu constraint diferido
  impedem identidade nova sem perfil se a transação Auth falhar.
- Sucesso de Auth, mas e-mail não entregue/aceito: preservar identidade e trilha;
  diagnosticar SMTP/redirect. Qualquer reenvio ou exclusão exige decisão própria.
- Após sucesso: fechar o ramo excepcional, preservar auditoria e não modificar
  as cinco contas anteriores. Reverter o **acesso** da nova identidade é uma
  operação separada, com autorização própria; não está automatizada.
- O token é bearer até consumo e reside brevemente na memória do processo e
  nos metadados de criação enviados à Auth; controles de acesso e ausência de
  logs são essenciais. Uma conta Supabase com permissão privilegiada ou acesso
  à chave de serviço ainda pode causar dano fora deste script. A aprovação e a
  verificação do operador são gates humanos e técnicos complementares.

## Testes e revisão

Laboratório próprio em `scripts/tmp/qa-admin-recovery-lab-20261114`, com schema
0001–0033, dados sintéticos e portas 55421–55429. O teste local exerce
autorização válida, token ausente/inválido/expirado/reutilizado, outro e-mail,
INSERT como `authenticated`, falha de auditoria com rollback Auth, duas chamadas
concorrentes, guarda de projeto ausente, bloqueio de fechamento prematuro,
grants privados, AAL1 bloqueado na RPC administrativa e fechamento com auditoria
preservada. Não prova entrega real de e-mail, aceitação pelo
titular, TOTP AAL2 real nem integração no QA.

O laboratório foi iniciado com Supabase CLI 2.116.0 em diretório ignorado pelo
Git, migrado até 0033, executado e encerrado por ID próprio com `--no-backup`.
Para reproduzir, recriar esse diretório isolado com `supabase init`, atribuir
portas 55421–55429, desativar seed, copiar somente migrations 0001–0033,
iniciar a stack, executar `node scripts/homologacao/qa-admin-recovery/test-local.mjs`
e pará-la por `--project-id qa-admin-recovery-lab-20261114`. O teste exige base
local vazia em cada execução; não aponta para QA remoto. Uma tentativa de
remover recursivamente o diretório ignorado após encerrar a stack foi rejeitada
pela revisão automática de comandos, então os arquivos locais do laboratório
permaneceram. Nenhum volume Docker do laboratório ficou ativo.

Revisão independente de segurança confirmou por leitura de código grants, RLS,
SECURITY DEFINER, search_path, replay, concorrência, fuga de token, rollback,
idempotência e isolamento QA/Production, com PASS para apresentação à aprovação
específica. O revisor executou `node --check`; não repetiu a suíte local.

| Etapa | Estado |
| --- | --- |
| Analisar fluxo normal e esquema atual | Concluída |
| Implementar artefatos locais QA-only | Concluída |
| Testar laboratório descartável | Concluída, cenários acima PASS |
| Revisar independentemente | Concluída, PASS para plano |
| Validar e relatar | Concluída nesta etapa; execução remota pendente |

**Operações remotas executadas nesta etapa:** somente leituras QA já relatadas;
nenhuma escrita em QA, Production ou DR. Sem commit, push ou deploy.
