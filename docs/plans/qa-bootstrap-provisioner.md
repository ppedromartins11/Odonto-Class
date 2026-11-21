# Bootstrap inicial do administrador — plano de execução

## Objetivo

Resolver o ciclo de dependências da migration 0030 para o primeiro administrador, sem alterar migrations históricas. A migration 0032 cria uma autorização privada, privilegiada, de uso único. O token de 256 bits apenas localiza essa autorização; o perfil e o nome vêm do banco. QA (`zxvpyxvhymuibaxgxetf`) é o único destino remoto desta execução.

## Estado inicial confirmado

QA tem 0001–0031, signup desabilitado, `auth.users=0`, `public.usuarios=0`, convites=0. Production e DR são protegidos. O laboratório local aplica 0001–0029, registra o inventário inicial, aplica 0030–0032 e cria o primeiro administrador pela Auth Admin API e pelos triggers da 0032.

## Desenho e invariantes

1. Tabela singleton em schema privado, sem USAGE/grants para papéis API e com RLS. Uma linha consumida permanece como trava histórica contra replay. Somente PostgreSQL privilegiado cria a autorização.
2. `handle_new_auth_user` mantém o convite 0030. O Auth grava `app_metadata` em UPDATE posterior ao INSERT. Na criação inicial, o INSERT só reserva o usuário dentro da transação; o UPDATE valida o token sob advisory lock, cria administrador ativo, consome autorização e remove o token. Um constraint trigger diferido impede COMMIT sem perfil.
3. O comando local valida refs oficiais, vínculo CLI, URL e DB QA, 0032 aplicada, signup desabilitado e inventário vazio antes de gerar segredos. Confirmação própria para o bootstrap. Lock local impede dois comandos simultâneos. Credenciais e manifesto preparado são gravados em arquivos ignorados antes da mutation remota; o manifesto permite recuperação de autorização pendente ou resposta Auth perdida.
4. Falha intermediária exige prova de estado e não adota conta desconhecida. Identidade existente só é reutilizada se manifesto, Auth, perfil, autorização e login coincidirem.

## Etapas

- [x] Implementar 0032 e atualizar gates de sequência.
- [x] Implementar comando e testes de falha, concorrência e isolamento locais.
- [x] Executar testes locais completos e laboratório Supabase local com 0032: 262 unitários, 283 integrações, zero skips, H01–H06, concorrência, advisors e cleanup PASS em 07/10/2026. `npm run homologate:local` terminou globalmente FAIL apenas porque QA remoto ainda tem 0031 e atores ausentes.
- [x] Obter revisão independente de segurança da migration, grants, definer, lock e replay.
- [x] Aplicar 0032 somente no QA; verificar advisors e estado.
- [x] Executar bootstrap, provar Auth/perfil/login/MFA e criar quatro atores normais.
- [x] Executar preflight remoto e homologação integral; registrar cleanup e prova.

Nenhuma mutation remota antecede testes e revisão. Nenhuma alteração em Production/DR, commit, push ou deploy faz parte deste plano.

## Resultado em 09/10/2026

Migration 0032 aplicada somente ao QA e confirmada em 32 migrations. Bootstrap administrativo criado pela Auth Admin API, com perfil e AAL2 verificados. Quatro atores sintéticos provisionados pelo convite normal, com 22 entidades registradas no manifesto do run `d4faf192-b91d-4fc5-91b4-863b01bab0e2`. A revisão independente de segurança aprovou migration, bootstrap, provisionamento e teardown após correções.

`npm run homologate` concluiu `HOMOLOGATION: PASS` no run `20261009185509250-9d93e380-f381-439a-b44b-0c7c777b25ca`: 267 testes unitários e 283 de integração, zero falhas/skips; H01–H06, concorrência, RLS/RBAC, lint, typecheck, build, advisors, cleanup local e proof PASS. O teardown remoto posterior removeu os quatro atores e comprovou zero entidades remanescentes do manifesto; QA ficou com somente o administrador inicial (Auth=1, perfil=1), profissionais=0, convites=0, fatores MFA=0. Evidências ignoradas pelo Git: `artifacts/homologacao/latest.json` e `qa-actors-cleanup-proof.json`.

O runner registra `PRODUCTION GATE: BLOCKED` por política explícita; sete avisos preexistentes de performance ainda indicam `REQUIRES_RELEASE_REVIEW`. Não houve escrita em Production/DR, commit, push ou deploy.
