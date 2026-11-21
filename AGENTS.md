# Odonto Class — instruções para Codex

Sistema real de gestão de clínica odontológica. Trabalhe com autonomia em mudanças locais e reversíveis; preserve dados clínicos, segurança e o estado da release.

## Fontes de verdade

Inspecione primeiro o fluxo em `app/`, `lib/`, `supabase/migrations/` e os testes. Consulte `docs/REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/DATABASE.md`, `docs/SECURITY.md` e `docs/TESTING.md` para regras e contexto. Documentos de sprint descrevem seu momento histórico: confirme o estado atual antes de tratar um status remoto como vigente. `CLAUDE.md` contém orientação legada; em caso de divergência, investigue código e decisões registradas, e respeite a instrução do usuário.

## Fluxo e agentes

Siga analisar → planejar → implementar → testar → revisar → validar → relatar. Verifique `git status --short` antes de editar; preserve alterações preexistentes. O agente principal delimita escopo, decide arquitetura, coordena e integra; não delega a responsabilidade final. Para trabalho grande ou de alto risco, mantenha um plano em `docs/plans/` baseado em `docs/EXECPLAN_TEMPLATE.md`. Para trabalho pequeno, use plano implícito.

Use os especialistas em `.codex/agents/` conforme `docs/AGENT_ARCHITECTURE.md`. Delegue apenas tarefas independentes, com arquivos e entregas delimitados. Um arquivo crítico tem um único responsável por escrita; outros agentes analisam ou revisam. Auth, RLS, migrations, dados clínicos, financeiro, estoque, concorrência e operações destrutivas exigem revisão independente do `security_reviewer` quando disponível. Se ela não ocorrer, declare a pendência; não a apresente como concluída.

## Código e banco

Siga os padrões existentes de Next.js App Router, TypeScript, React, npm e Supabase. Prefira a menor mudança correta; não acrescente dependências ou abstrações sem necessidade. Toda autorização deve ser aplicada no servidor/banco, nunca apenas na UI. Preserve guards SSR, MFA/AAL2, sessões e limites de papel. `user_metadata` não é autoridade para perfil. `service_role` é somente server-side e exige autorização prévia na aplicação.

Migration já aplicada é imutável; corrija em nova migration. Não edite uma migration histórica para fazer testes passar. Toda nova tabela sensível nasce com RLS. Em mudanças SQL, examine grants, policies, funções `SECURITY DEFINER`, `search_path`, acesso `anon`/`authenticated`/`service_role`, constraints, concorrência, transações e falhas parciais. Não relaxe RLS nem crie bypass temporário. O estado remoto de 0030/0031 deve ser confirmado antes de qualquer plano de aplicação; até haver comprovação da conclusão dos gates de homologação, trate 0031 como bloqueada.

## Dados e operações externas

Use apenas dados fictícios em desenvolvimento e testes. Não exponha paciente, prontuário, CID, PDF, Storage privado, URL assinada, senha, JWT, token, TOTP, chave ou connection string em logs, diffs ou relatórios. Nunca ponha segredo no bundle ou no Git. Não faça signup público ou confirmação arbitrária de e-mail para contornar testes.

Pode investigar e editar localmente dentro do escopo solicitado. `git commit`, `push`, `merge`, `rebase`, `reset --hard`, limpeza destrutiva, migration remota, escrita/cleanup em Supabase, alteração de Auth/secrets/DNS, deploy e mudanças em Production exigem instrução explícita para a ação concreta. Uma instrução anterior limitada a outro passo não autoriza o seguinte. Prepare plano e impacto antes de pedir a decisão necessária. Nunca execute scripts de homologação ou integração remota por hábito.

## Validação e conclusão

Use testes focados durante desenvolvimento. Para entrega relevante, conforme o impacto: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` e `git diff --check`. `npm run test:integration` usa Supabase e requer ambiente fictício isolado e autorização específica. Em bug, acrescente regressão significativa quando possível; para regra crítica, valide autorização com integração adequada. Não declare teste ou homologação executados sem evidência.

Conclua quando requisito e integração estiverem atendidos, diff/escopo revisados, testes aplicáveis passarem, segurança e documentação necessárias estiverem verificadas e riscos residuais constarem no relatório. Informe arquivos alterados, validações reais, estado de banco/release quando relevante e pendências. Não faça commit, push ou deploy por padrão.
