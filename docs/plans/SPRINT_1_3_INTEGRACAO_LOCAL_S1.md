# Sprint 1.3 — integração local S1

**Data:** 14/11/2026 (America/Cuiaba). **Resultado:** preflight bloqueado; integração não iniciada. Este registro não aprova QA, recuperação nem Production.

## 1. Preflight e limite de isolamento

| Verificação somente leitura | Evidência observada | Decisão |
| --- | --- | --- |
| Docker Engine | `docker version --format '{{.Server.Version}}'` falhou: pipe `dockerDesktopLinuxEngine` inexistente; daemon Linux indisponível. | **BLOCKED** para stack Supabase local. |
| Node | `node --version`: `v24.19.0`. | Disponível. |
| CLI do projeto | `npx.cmd supabase --version`: `2.116.0`. O aviso da CLI menciona uma versão mais recente; nenhuma atualização foi feita. | Disponível, não executada contra banco. |
| Configuração local | `supabase/config.toml` ausente; `supabase/.temp/project-ref` presente, sem leitura de seu valor. Variáveis de conexão consultadas no processo atual estavam ausentes; o build identificou `.env.local`, cujo conteúdo não foi lido. `vitest.integration.config.mts:4-6` pode carregar arquivos `.env` de teste. | **Isolamento não comprovado.** O vínculo existente impede tratar este checkout como laboratório descartável sem preparação separada. |
| Guard de integração | `tests/integration/setup-isolation.mjs:5-11` chama `projectGuard`; em modo local, `scripts/homologacao/lib/safety.mjs:9-17` exige confirmação fictícia, URLs API/DB/app em loopback e URL pública correspondente. | Guarda de código presente; não substitui verificar stack, chaves e variáveis efetivas antes da execução. |
| Migrations locais | Há 34 arquivos SQL, com prefixos 0001–0034 únicos. | Inventário local; **nenhuma migration foi aplicada ou validada por PostgreSQL**. |

A documentação oficial da Supabase exige CLI e runtime compatível com Docker para iniciar a stack local no Windows; `supabase start` inicia containers e requer `supabase/config.toml`. Consultas: [desenvolvimento local](https://supabase.com/docs/guides/local-development), [CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) e [testes de banco](https://supabase.com/docs/guides/local-development/cli/testing-and-linting). A documentação publicada pode evoluir; a versão instalada observada foi 2.116.0. Não se usou QA como alternativa.

## 2. Comandos de escrita identificados antes de qualquer execução

| Comando ou fluxo futuro | Efeito previsto | Condição de segurança |
| --- | --- | --- |
| `npx.cmd supabase start` em diretório isolado | Cria/inicia containers locais e prepara serviços/migrations locais. | Docker saudável, `config.toml` próprio, projeto sem vínculo remoto, portas e URLs loopback. **Não executado.** |
| `npx.cmd supabase db reset` | Descarta e recria **apenas** o banco da stack local identificada; aplica migrations/seed configurados. | Só dentro de laboratório novo e descartável, com alvo demonstrado antes. **Não executado.** |
| `npm.cmd run test:integration` | Cria e remove contas, pacientes fictícios, metadados, provas e objetos privados; alguns testes usam conexão SQL. | `SUPABASE_TEST_ENVIRONMENT=local`, URLs API/DB/app em loopback, credenciais geradas pela stack local, guard PASS e inventário de migrations 0001–0034 aplicado apenas nela. **Não executado.** |
| Teste HTTP local de download | Inicia app local e emite requests/URLs assinadas da stack local. | Backend e app apontando exclusivamente ao mesmo laboratório, com fixtures fictícias e sem persistir signed URLs. **Não executado.** |

`db push`, `migration repair`, `restore`, seed remoto, deploy e operações em QA/Production ficam fora deste laboratório. Não foi executado comando de escrita em banco ou Storage.

## 3. Testes preparados e lacunas de cobertura integrada

| Requisito S1 | Preparação existente | Resultado nesta sprint |
| --- | --- | --- |
| Upload legítimo, metadata, hash/tamanho/MIME, namespace, bucket e objeto ausente | `tests/integration/documents-official.authorization.test.ts:20-56,167-198`; `operational.authorization.test.ts:22-30,79-125`. | **Não executado**; depende da stack local. |
| Prova ligada a ator/finalidade, replay, concorrência e rollback sem linha parcial | `documents-official.authorization.test.ts:201-225`; `operational.authorization.test.ts:128-145`. | **Não executado**. |
| RPCs antigas, perfis/CID, acesso direto ao Storage e download | `documents-official.authorization.test.ts:124-127`; `operational.authorization.test.ts:68-89,149-153`; `release-highs.authorization.test.ts:103-143`; testes unitários das rotas `app/api/{documentos,arquivos}/[id]/route.test.ts`. | Unitários passaram no runner geral; integração e HTTP real **não executados**. |
| Banco: RLS, grants, PUBLIC, overloads, trigger privado, `SECURITY DEFINER`, `search_path` e `auth.uid()` | Migration proposta `0034_verified_patient_upload_metadata.sql`; revisão estática da Sprint 1.2. | **Não comprovado no catálogo efetivo**; preparar consultas `pg_proc`, `pg_namespace`, `pg_class`, `pg_policy` e `has_function_privilege` apenas para a stack local. |
| Prova expirada, legado inconsistente e falha intermediária Storage/SQL | Casos correlatos em testes existentes e plano S1. | **Pendente de casos integrados específicos**: expirar prova no banco local fictício; verificar zero metadata/auditoria; criar linha legada conforme e linha inconsistente por fixture controlada para negar URL; simular erro após upload e conferir compensação/preservação conforme estado da RPC. |
| Logs | Código não imprime token, URL ou conteúdo nos caminhos revisados estaticamente. | Inspeção de logs de execução **pendente**; nenhuma captura clínica ou credencial foi produzida. |

Ao retomar, escrever e executar os casos pendentes acima sem enfraquecer as assertions existentes. Para expiração, usar somente conexão SQL do banco local isolado e prova de fixture; nunca alterar relógio ou linha em QA. Para HTTP, verificar por papel status, ausência de `Location` nas negações, `Cache-Control: private, no-store`, duração da URL e hash do binário autorizado, sem registrar a própria URL.

## 4. Regressão local executada

| Classificação | Resultado real |
| --- | --- |
| **PASS local unitário** | `npm.cmd run lint` PASS; `npm.cmd run typecheck` PASS; `npm.cmd test` PASS: 52 arquivos, 323 testes aprovados, 0 reprovados, 1 skip condicionado; `npm.cmd run build` PASS com Next.js 16.3.8. |
| **PASS local integrado** | **Não obtido**. Docker/stack indisponíveis; zero migrations aplicadas, zero testes de banco, concorrência SQL ou HTTP real executados. |
| **Revisão independente** | A revisão estática S1 da Sprint 1.2 registrou PASS local com QA bloqueado. Não houve diff de produção nesta Sprint 1.3; nova revisão do catálogo, resultados integrados e eventuais correções fica pendente. |
| **QA pendente** | Nenhum acesso ou alteração nesta sprint. Requer decisão própria após PASS local integrado e isolamento confirmado. |
| **Recovery pendente** | Nenhum restore ou exercício executado. |
| **Production bloqueada** | Nenhum acesso, deploy ou alteração. |

O fingerprint v2 do código permanece `7fe43f4302a7e5facba8f42b87ee0c5ba57a82b6556ef49c581b0e94b44b4254`; somente este relatório foi criado nesta sprint. A documentação geral não integra o fingerprint executável. `git diff --check` do relatório novo não é avaliado pelo Git enquanto ele permanece não rastreado.

## 5. Próximo preflight e critérios para futura QA

1. Em um diretório de laboratório separado deste checkout vinculado, iniciar Docker compatível e criar `supabase/config.toml` próprio; comprovar portas, URLs e credenciais **somente locais**, sem exibir seus valores em relatório.
2. Inventariar comandos e alvos novamente; aplicar 0001–0034 só no banco descartável e conferir sequência, catálogo, triggers, grants, RLS, overloads e ausência de execução direta das três RPCs legadas.
3. Executar suites integradas e HTTP com fixtures exclusivamente fictícias, incluindo expiração, concorrência e rollback. Registrar contagens PASS/FAIL e cleanup sem conteúdo clínico, token ou URL assinada.
4. Corrigir apenas falhas demonstradas, em migration **nova** se houver schema já aplicado em qualquer ambiente; repetir regressão, fingerprint e revisão independente do diff final.
5. Somente depois, solicitar decisão concreta e separada para leitura/alteração em QA. Recuperação e Production continuam gates próprios.

**Riscos residuais:** execução real da 0034 e de sua dependência de Storage permanece desconhecida; versão de serviço local e comportamento de `storage.info()` não foram observados em runtime; o worktree contém mudanças preexistentes e um vínculo CLI, portanto nenhuma inferência sobre QA ou banco remoto é válida.

## Sprint 1.3B — tentativa de laboratório independente, 14/11/2026

Esta seção atualiza o bloqueio anterior sem reescrever sua evidência histórica. **Docker Engine Linux ficou disponível, mas a prova de isolamento de rede falhou no `supabase start`; nenhuma migration ou suite integrada foi executada.** O projeto original, o projeto local preexistente e os ambientes remotos não foram alterados.

### Preflight e inventário de escrita

| Verificação ou comando | Alvo e resultado real |
| --- | --- |
| `docker version` e `docker info` | Engine Linux `29.7.2`, Docker Desktop; PASS de disponibilidade. Já existiam containers de outros projetos, inclusive Odonto, que não foram parados, resetados ou usados. |
| CLI | `npx.cmd supabase --version`: `2.116.0` em repetição sequencial; `supabase --help`, `start --help` e `init --help` consultados. Chamadas paralelas ocasionaram `EPERM` ao renomear arquivo de telemetria local da CLI; a repetição sequencial passou. Nenhum comando remoto da CLI foi usado. |
| Portas | Padrão `54321–54324` ocupado por outro projeto; `55320,55321,55322,55323,55324,55327,55329,55330` sem listener no preflight. Diagnóstico posterior com `netsh` mostrou `55319–55418` em **faixa excluída TCP IPv4 e IPv6** pelo Windows. Ausência de listener não garante porta publicável. |
| Ambiente efetivo inicial | Nenhuma variável de processo com nome Supabase/DB/Vercel/Homologation; `.env.local`, `.env.test.local` e `.env.homologacao.local` existem apenas no original e **não foram copiados**. Nenhuma chave, URL completa, ref ou conteúdo privado foi impresso. |
| Cópia filtrada | Criado `C:\dev\odonto-class-lab`, previamente inexistente; 338 arquivos de `app`, `components`, `lib`, `public`, `tests/integration`, `scripts/homologacao` e migrations, mais configs/manifestos necessários. Incluiu alterações locais não commitadas. Sem `.env`, `.git`, `node_modules`, backups, artefatos, PDF privado ou `project-ref`. As 34 migrations 0001–0034 têm SHA-256 idêntico ao original, prefixos únicos e ordem sequencial. |
| `supabase init` | Executado **somente** no laboratório: criou `supabase/config.toml` com `project_id = "odonto-class-lab"`; não fez login/link. Configuração ajustada apenas no laboratório para portas 55320–55329, URL de retorno loopback e `db.seed.enabled = false`. |
| Rede Docker própria | `docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 odonto-class-lab-loopback`; inspeção confirmou driver bridge e opção `127.0.0.1`. A rede permanece identificada para investigação futura. |
| `supabase start` | Duas tentativas **somente** com cwd no laboratório e `--network-id odonto-class-lab-loopback`; ambas falharam antes de aplicar migrations. Erro da segunda tentativa: Docker tentou publicar `0.0.0.0:55322` e o Windows recusou o bind (`LegacyContainerStartError`). A rede configurada não impediu o bind em todas as interfaces. **Isolamento não comprovado; execução interrompida.** |

Comandos que poderiam escrever em banco/Storage foram inventariados antes do start: `supabase start` aplicaria migrations apenas na stack identificada; `npm ci` escreveria dependências apenas no laboratório; `npm run test:integration` criaria/removeria fixtures fictícias; testes HTTP emitiriam URLs locais. **`npm ci`, `db reset`, testes integrados, HTTP, cleanup de fixtures, migrations remotas, deploy, commit e push não foram executados.** Após a falha, `docker ps -a` mostrou **zero containers** com o identificador do laboratório e não havia `project-ref` nele; nenhuma aplicação da 0034 foi observada. A rede e a pasta do laboratório foram preservadas, sem limpeza destrutiva.

A [documentação oficial de projetos locais múltiplos](https://supabase.com/docs/guides/local-development/running-multiple-local-projects) explica que `supabase init` fixa portas no `config.toml`; a [referência da CLI](https://supabase.com/docs/reference/cli/introduction) descreve `start` como operação local. O `--help` da versão **instalada** foi conferido diretamente. O comportamento do Docker Desktop no Windows exige investigação específica antes de outra tentativa, para provar bind exclusivamente em loopback sem alterar as stacks existentes.

### Matriz de autorização e validação

| Controle | anon | authenticated por papel | service_role | Estado |
| --- | --- | --- | --- | --- |
| Prova `prepare_upload_attestation` e cancelamento | Esperado negado | Esperado negado | Esperado permitido | **Não testado** em banco. |
| RPCs antigas de criação | Esperado negado | Esperado negado | Esperado negado | **Não testado** em catálogo efetivo. |
| RPCs verificadas, CID e download | Esperado negado | Matriz admin/recepção/dentista por paciente/autor | Sem exposição ao navegador | **Não testado** em banco/HTTP. |
| Storage privado e signed URL | Esperado negado | Acesso direto esperado negado; rota por papel | Servidor após autorização | **Não testado** na stack nova. |

Casos de prova expirada, legado inconsistente, falha intermediária Storage/SQL, concorrência e rollback permanecem **preparados ou especificados**, sem PASS integrado. Nenhuma fixture foi criada; limpeza de fixtures é não aplicável. Logs de execução clínica não existem nesta tentativa; o erro de start não incluiu conteúdo de paciente.

| Classificação exigida | Situação em 1.3B |
| --- | --- |
| **PASS unitário** | Última execução local documentada na Sprint 1.3: lint, typecheck, 323 testes PASS/1 skip e build; não repetida nesta tentativa sem mudança de código. |
| **PASS integrado** | **BLOCKED**, zero suites e zero migrations executadas. |
| **Revisão estática** | Parecer S1 anterior permanece histórico; não houve modificação de código/schema nesta tentativa. Revisão independente de resultados integrados continua pendente. |
| **QA pendente** | Sem acesso ou mutação. |
| **Recovery pendente** | Sem restore. |
| **Production bloqueada** | Sem acesso ou mutação. |

**Próximo passo seguro:** escolher uma faixa de portas livre de listeners **e** das exclusões TCP do Windows; investigar por que Docker Desktop tentou publicar em `0.0.0.0` apesar da opção da rede. Demonstrar `127.0.0.1` em todos os containers e endpoints, repetir preflight de variáveis/portas e só então iniciar uma stack descartável. Não reutilizar os containers Odonto ou BuscaPet preexistentes. O fingerprint v2 do código não mudou: `7fe43f4302a7e5facba8f42b87ee0c5ba57a82b6556ef49c581b0e94b44b4254`.

## Sprint 1.3D — preflight de VM Linux isolada, 14/11/2026

**Estado: BLOCKED antes de qualquer operação com escrita em VM, banco ou Storage.** Não foi localizada uma plataforma de VM Linux gerenciável nem foi possível demonstrar a topologia de rede de um guest. A presença do hypervisor usada pelo Docker/WSL não demonstra disponibilidade do gerenciador Hyper-V nem isolamento de uma VM.

| Verificação somente leitura no host | Resultado observado | Limite da evidência |
| --- | --- | --- |
| VirtualBox | `VBoxManage.exe` não encontrado no `PATH` nem nos caminhos usuais `C:\Program Files\Oracle\VirtualBox` e `C:\Program Files\VirtualBox`; serviço `VBoxSVC` ausente. | Não comprova ausência em todo o disco, mas não há instalação utilizável identificada. |
| Hyper-V | Módulo PowerShell Hyper-V e comando `Get-VM` ausentes; serviço `vmms` ausente. `Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All` retornou `The requested operation requires elevation`. | Estado do recurso não pôde ser confirmado sem elevação; nenhuma VM foi inventariada ou alterada. |
| Virtualização e Docker | `VirtualizationFirmwareEnabled=True`, `HypervisorPresent=True`; `vmcompute` em execução. | Esses sinais são compatíveis com o runtime já existente e não provam que uma VM Linux dedicada possa ser criada ou isolada. |
| Laboratório | Nenhum disco/configuração de VM (`.vbox`, `.vhdx`, `.vdi`, `.qcow2`) encontrado em `C:\dev\odonto-class-lab`. | Não há guest desse laboratório para inspecionar interfaces, rotas ou serviços. |

### Arquitetura proposta, ainda não implantada

Criar **uma VM Linux dedicada** e uma rede dedicada, ligada apenas a ela e ao host: adaptador **host-only** no VirtualBox ou switch **Internal** no Hyper-V. Não conectar a VM ao switch externo, à rede das outras VMs nem à bridge dos containers existentes. O switch Internal permite comunicação host–guest, mas [pode receber NAT se configurado separadamente](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-switch-for-hyper-v-virtual-machines); por isso seu tipo sozinho não comprova isolamento. O [host-only do VirtualBox](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/networkingdetails.html) também precisa de inspeção da configuração efetiva e das demais interfaces.

Para obter Linux, Docker e Supabase CLI, a conectividade externa seria temporária **somente durante o provisionamento**. Antes de iniciar a stack ou executar qualquer teste: remover/desabilitar o adaptador externo/NAT da VM, verificar que só restam loopback e a interface host-only, que não existe rota default IPv4/IPv6, encaminhamento/ICS/NAT/port forwarding para LAN, nem outra VM ligada à mesma rede. Os serviços e testes Supabase rodariam **dentro da VM**, com endpoints limitados ao loopback do guest; o host-only serviria apenas para transferência controlada dos arquivos permitidos. Conferir `ip -br addr`, `ip route`, `ip -6 route`, interfaces e rotas do host, configuração do hipervisor, `docker inspect` dos binds, listeners e tentativas de conexão externas sem usar URLs de QA/Production. Qualquer conectividade inesperada mantém o bloqueio.

Transferir apenas o código, testes e migrations necessários da cópia filtrada do laboratório, após novo inventário e verificação de hashes; excluir `.env`, credenciais, backups, `.git`, `project-ref`, dados reais, caches e artefatos. Gerar configuração e chaves exclusivamente dentro do guest. Antes de qualquer escrita em banco/Storage, registrar comando, diretório, project id local, containers/volumes de destino, portas, variáveis efetivas sem valores sensíveis e a ordem única 0001–0034. `supabase start` e eventual `db reset` atingiriam somente a VM descartável; `npm run test:integration` escreveria apenas fixtures fictícias nela. **Nenhum desses comandos foi executado nesta etapa.**

| Entrega solicitada | Resultado real em 1.3D |
| --- | --- |
| Isolamento e rede efetiva | **BLOCKED**: VM não criada, interfaces/rotas do guest e binds não observáveis. |
| Migrations 0001–0034 | **0 aplicadas** nesta etapa; a ordem foi inventariada anteriormente, sem validação PostgreSQL. |
| Integração S1, concorrência, replay, expiração, rollback, Storage e HTTP | **0 testes executados** nesta etapa. Não há fixtures para limpar. |
| Matriz de autorização anon/authenticated/service_role e admin/recepção/dentista | **Não comprovada em runtime**; expectativas da seção 1.3B permanecem hipóteses a testar. |
| PASS local unitário | Último resultado histórico documentado: 323 PASS, 1 skip; não reexecutado nesta etapa. |
| PASS local integrado | **Não obtido.** |
| Revisão estática/independente | Parecer estático S1 anterior; sem novo diff de código ou migration e sem revisão de resultado integrado. |
| QA / Recovery / Production | **QA pendente; Recovery pendente; Production bloqueada.** Sem acesso ou alterações. |

O fingerprint v2 de código registrado anteriormente (`7fe43f4302a7e5facba8f42b87ee0c5ba57a82b6556ef49c581b0e94b44b4254`) **não foi recalculado nesta etapa**; nenhum arquivo executável foi editado. O risco principal é a ausência de prova de isolamento da VM. A validação integrada e a decisão futura sobre QA continuam condicionadas a essa prova e aos resultados reais, sem reutilizar containers ou dados existentes.
