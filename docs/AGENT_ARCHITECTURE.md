# Arquitetura de agentes Codex — Odonto Class

## Diagnóstico que orientou a divisão

O código é um monólito Next.js 16/React 19/TypeScript com App Router: páginas e componentes em `app/`, Server Actions/Route Handlers em `app/`, regras e clientes Supabase em `lib/`. `supabase/migrations/` contém 0001–0031; o banco concentra RLS, RPCs e integridade. Há testes Vitest unitários junto aos módulos e em `tests/`; `tests/integration/` usa ambiente Supabase fictício. `.github/workflows/ci.yml` roda lint, typecheck, unitários e build em push/PR para `main`; a integração é opt-in via `workflow_dispatch`. `package.json` também expõe scripts de seed/homologação/cleanup que podem escrever remotamente e nunca devem ser executados como teste rotineiro.

Os domínios implementados incluem Auth/usuários, pacientes, agenda/atendimentos, documentos/PDF/Storage, tarefas/retornos, orçamentos/tratamentos/financeiro e estoque/lotes/validade/esterilização. A fronteira técnica mais arriscada é autorização entre aplicação, Auth e Postgres. Por isso backend, banco e revisão de segurança são papéis distintos. Análise de domínio e arquitetura ficam com o lead, evitando um oitavo papel que participaria de quase toda tarefa.

Não havia `AGENTS.md` na raiz. `CLAUDE.md` já reúne muitas regras semelhantes e começa com o título “AGENTS.md”, mas não é o arquivo de descoberta padrão do Codex. Não foi modificado porque já contém trabalho local preexistente. `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` e documentos de sprint guardam snapshots com status de migrations em momentos distintos; use-os como contexto, não como prova do estado remoto atual. A informação operacional recebida nesta tarefa é 0030 aplicada em homologação e 0031 ainda bloqueada, sem consulta remota nesta rodada.

## Mecanismo real e descoberta

Nesta instalação, `codex --version` retornou **0.160.0**, `multi_agent` e `worktrees` aparecem estáveis em `codex features list`. A [documentação oficial de subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents) especifica arquivos TOML de projeto em `.codex/agents/` com `name`, `description` e `developer_instructions`. Codex usa a descrição para escolher o papel e carrega o TOML como camada de configuração do subagente. Não fixamos modelo nem custo por agente; eles herdam as escolhas da sessão. O `security_reviewer` usa `sandbox_mode = "read-only"`; as proibições operacionais dos demais estão nas instruções, pois um arquivo de prompt não substitui controles de permissão do ambiente.

O [AGENTS.md oficial](https://learn.chatgpt.com/docs/agent-configuration/agents-md) é lido na abertura da sessão a partir da raiz até o diretório corrente. O arquivo raiz contém normas comuns e o lead; não foram criados `AGENTS.md` por pasta porque os papéis são transversais e isso duplicaria regras. Abra uma nova sessão Codex após adicionar/alterar essas instruções para assegurar sua carga. Em clientes que não carreguem agentes TOML do projeto, o lead pode delegar com o contrato do papel copiado no handoff; não presuma que o nome do papel ativou um TOML nesse cliente. Configurações de permissão/sandbox da sessão principal podem prevalecer sobre a configuração de um subagente; confira o modo efetivo antes de uma revisão sensível.

Não é necessário `.codex/config.toml` para descobrir os agentes; a pasta oficial basta. Não foram criados skills ou plugins: este trabalho define papéis persistentes, não procedimentos acionados por uma habilidade específica. Para tarefas locais que peçam subagentes, o lead solicita os papéis por nome. No CLI interativo, `/agent` permite acompanhar threads. O [suporte oficial a worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees) e `codex --worktree` existem, mas um worktree é opção de isolamento deliberada, não requisito de cada tarefa.

## Sete papéis, seis especialistas

O `qa` também responde por homologação, integração, regressão, concorrência,
validação de migrations, cleanup/proof e release gates. Consulta `database` e
`security_reviewer`; a revisão final independente usa o revisor existente, e
`release` cuida da fronteira operacional. Nenhum novo papel foi necessário.
Veja [HOMOLOGATION.md](HOMOLOGATION.md) para o procedimento atual. Status de
migrations nas seções históricas abaixo não substitui consulta atual: nesta
tarefa o solicitante informou 0030/0031 aplicadas em homologação, ainda sujeitas
à confirmação read-only pelo novo checkpoint.

| Papel | Quando entra | Fronteira principal | Saída esperada |
| --- | --- | --- | --- |
| **Lead / orquestrador** (`AGENTS.md`) | Toda solicitação | Investiga, decide escopo/arquitetura, integra e valida; não terceiriza a decisão final | Plano ou decisão curta, resultado consolidado e riscos |
| **frontend** | UI, formulário, responsividade, acessibilidade | TSX/CSS sem mudar Auth, SQL ou regra de negócio por conta própria | Interface e estados validados |
| **backend** | Server Actions, APIs, Auth SSR, Storage | Contrato da aplicação; SQL/RLS pertence a database | Fluxo server-side e acessos negados comprovados |
| **database** | Schema, migration, RLS, RPC, integridade | SQL local; aplicação/remoto pertence ao gate de release | Delta SQL, matriz de grants/policies e invariantes |
| **qa** | Regressão, aceite, testes negativos/concorrência | Testa sem inventar comportamento e sem integração remota implícita | Evidência reproduzível e lacunas |
| **security_reviewer** | Risco alto ou auditoria solicitada | Revisão independente read-only; não implementa | Achados com evidência, PASS/FAIL/BLOCKED |
| **release** | CI, ambiente, compatibilidade, rollout | Planeja/valida localmente; não faz operação remota sem instrução explícita | Gates, sequência e comandos revisáveis |

Cada TOML define missão, acionamento e exclusão, arquivos típicos, entrada, saída, ações permitidas/proibidas, escalonamento e critério de conclusão. Papéis descrevem responsabilidade, não concessão de privilégio: todos obedecem ao pedido do usuário, a `AGENTS.md` e às permissões reais da sessão.

## Seleção e fluxo

1. O lead lê o pedido, `git status --short`, código/testes e decisões relacionadas; identifica se a tarefa é simples, entre domínios ou de alto risco. Não infere o próximo item do backlog apenas do texto “continue”: verifica `docs/TODO.md`, requisitos, estado do código e pendências reais.
2. Em alteração pequena, o lead pode executar sozinho. Em módulo novo, Auth, SQL, financeiro, estoque ou alteração ampla, abre ExecPlan persistente a partir de [EXECPLAN_TEMPLATE.md](EXECPLAN_TEMPLATE.md) e atribui um owner por arquivo.
3. Delegação usa os papéis necessários, não todos por padrão. `frontend` e `backend` podem pesquisar partes independentes; `database` e `backend` coordenam contrato antes de editar arquivos acoplados. `qa` pode preparar matriz/casos em paralelo à implementação desde que os critérios estejam definidos.
4. Owner implementa localmente; lead integra. `qa` verifica comportamento e `security_reviewer` revisa mudanças de risco alto depois do diff estar estável. Achado relevante volta ao owner e recebe nova revisão.
5. Lead roda validações proporcionais, revisa diff/segredos, distingue evidência local de homologação remota e entrega relatório com pendências reais. Release remoto é etapa separada.

### Exemplos de roteamento

| Pedido | Papéis normalmente necessários |
| --- | --- |
| “Implemente o módulo X” | lead; frontend/backend; database se schema; qa; security_reviewer se dado sensível; release se há rollout |
| “Corrija este bug” | lead + owner do fluxo; qa para regressão; security_reviewer se altera autorização/integridade |
| “Revise a segurança do módulo financeiro” | security_reviewer read-only + lead; backend/database só para esclarecer ou corrigir após decisão |
| “Analise a próxima prioridade do MVP” ou “continue o desenvolvimento” | lead investiga código, `docs/TODO.md`, requisitos e gates; especialistas apenas para incertezas concretas |
| “Faça auditoria de RLS” | database para mapa read-only, security_reviewer independente, lead consolida |
| “Melhore a interface sem alterar regra de negócio” | frontend + lead; qa conforme risco de regressão |
| “Prepare a próxima release” | release + lead; database/backend/segurança para compatibilidade e gates, sem deploy implícito |

## Handoff mínimo

Envie uma tarefa limitada, não “cuide desse módulo”. Use este bloco em mensagens ao especialista e no ExecPlan quando houver:

```text
Objetivo e critério de aceite:
Contexto verificado (arquivos/símbolos/estado):
Arquivos de escrita atribuídos; arquivos apenas para leitura:
Invariantes (papéis, dados clínicos, migrations, Auth, release):
Mudanças já feitas e decisões tomadas:
Dúvidas ou bloqueios:
Testes a executar ou propor; ambiente permitido:
Riscos e resultado esperado do handoff:
```

Na devolução, o agente informa arquivos efetivamente alterados, evidência dos testes e seus limites, achados, risco residual e o que o lead precisa decidir. Não transfira credenciais, dados reais ou logs sensíveis no handoff. O lead não aceita “PASS” sem evidência e registra impedimentos sem fabricar resultado.

## Paralelismo e revisão

Paralelize investigação read-only e testes independentes. Para escrita, atribua um owner por arquivo; revisão lê o diff após a implementação. Não deixe dois agentes editarem simultaneamente `package.json`, migrations, ações de Auth, arquivo de política ou configuração de deploy. Em mudança extensa com trilhas realmente isoladas, um worktree separado pode reduzir conflito; antes de criar, avalie worktree sujo, arquivos ignorados, dependências de ambiente e como integrar o diff. Worktree não concede autorização para commit, merge, push nem operação remota.

Revisão independente é obrigatória para Auth/MFA, RLS, migrations, SQL privilegiado, documentos clínicos, financeiro, estoque, concorrência, permissões e exclusões. O revisor testa hipóteses de acesso indevido, integridade e exposição de dados e registra achados por gravidade com caminho/linha e cenário. O implementador corrige; o lead solicita segunda revisão dos pontos alterados. Se a revisão independente estiver indisponível, a entrega pode registrar implementação local, mas não declarar gate de segurança concluído.

## Fronteira de release

`npm test` é unitário pelo `vitest.config.mts`; `npm run test:integration` é opt-in e carrega ambiente de teste com acesso ao Supabase. Scripts `seed:homologacao`, `cleanup:homologacao` e `homologate:0030:*` também têm potencial de mutação. Nunca execute esses comandos como parte automática de validação local. Migrations aplicadas são imutáveis; 0031 não deve ser aplicada até que a homologação exigida a desbloqueie. Antes de qualquer operação remota, o lead/release confirma ambiente, impacto, pré-condições e autorização explícita para a ação concreta. Git commit/push/merge e Production também são passos separados.

## Prompts prontos para o agente principal

1. “Implemente o próximo módulo do MVP após conferir código, requisitos e pendências. Crie ExecPlan se envolver vários domínios; delegue só trilhas independentes. Faça apenas alterações locais.”
2. “Corrija o bug descrito abaixo, identifique a causa no fluxo real, acrescente regressão significativa e peça revisão independente se afetar autorização.”
3. “Faça uma auditoria read-only das policies RLS de documentos clínicos e mostre cenários permitidos/negados com evidências, sem alterar banco.”
4. “Melhore a interface de [tela] mantendo Server Actions, Auth e regras de negócio; valide desktop, mobile e acessibilidade.”
5. “Prepare a próxima release: compare código e migrations com o ambiente autorizado, liste gates, testes e comandos revisáveis; não execute deploy nem migrations.”
