# Registro de Decisoes (ADR resumido)

## Decisoes de escopo/modelagem aprovadas (PAV-09 a PAV-17)

| PAV | Decisao | Alternativa descartada |
|---|---|---|
| PAV-09 | Documento de identificacao do paciente opcional, sem validacao de formato. | Exigir CPF obrigatorio. |
| PAV-10 | Pagamento vincula no maximo UM de: atendimento OU orcamento. | Permitir os dois simultaneamente. |
| PAV-11 | Itens do orcamento em texto livre, sem catalogo de procedimentos. | Criar catalogo de procedimentos agora. |
| PAV-12 | Validade e esterilizacao na mesma tabela-base, com `categoria` + `detalhes` (jsonb) flexivel. | Duas tabelas separadas. |
| PAV-13 | Encaixe fora do MVP - bloqueio de conflito de horario sempre rigido. | Checagem apenas na aplicacao, ignoravel pelo usuario. |
| PAV-14 | Confirmacao manual de consulta, com lista de apoio "a confirmar". | Confirmacao automatica via canal externo (fora do MVP de qualquer forma). |
| PAV-15 | `atendimentos.agendamento_id` opcional. | Tornar obrigatorio (exigiria agendamento artificial para encaixe). |
| PAV-16 | Notacao FDI proposta para o campo `dente` (texto livre). | Notacao Universal. Pendente confirmacao dos dentistas. |
| PAV-17 | Sem exclusao fisica de prontuario; exclusao logica por padrao. | Definir prazo tecnico provisorio de retencao. Prazo formal ainda requer validacao profissional/juridica. |

Itens ainda abertos (nao fazem parte desta revisao): PAV-01 a PAV-08
(hipoteses originais do documento-fonte, incluindo RBAC detalhado),
PAV-18 (lista de eventos de auditoria), PAV-19 (limites de upload),
PAV-20 (MFA), PAV-21 (visibilidade financeira da recepcao).

## Decisoes de arquitetura

- **Stack**: Next.js + TypeScript + Tailwind + Supabase + Vercel,
  monolito modular (ver `docs/ARCHITECTURE.md` para justificativa).
- **Gerenciador de pacotes**: npm, por ja estar disponivel no ambiente
  de geracao e evitar uma decisao adicional nesta fase.
- **Nomenclatura**: tabelas/campos em portugues; codigo em ingles.
- **Perfis de usuario como ENUM** (nao tabela `perfis`) nesta fase -
  simplicidade para 3 perfis fixos; reavaliar se a clinica precisar de
  perfis customizados no futuro.

## Decisao sobre versoes de dependencias

Pesquisei (via busca na web, fora deste sandbox de execucao) que, na
data de hoje, a linha atual do Next.js e a 16.x, React 19.x e Tailwind
CSS 4.x, e que o TypeScript acabou de lancar a versao 7.0 com uma
reescrita grande do compilador e mudancas que quebram compatibilidade.

Isso NAO e o mesmo que validar a instalacao. Decisoes tomadas:

- Usar faixas de versao por major (`^16.0.0`, `^19.0.0`, `^4.0.0`,
  `^5.0.0`) no `package.json`, em vez de fixar um patch/minor exato -
  o numero exato que sera instalado depende do que o `npm install` do
  usuario resolver no momento em que ele rodar.
- Deliberadamente NAO usar TypeScript 7.0 ainda: e uma mudanca grande e
  muito recente, com risco real de incompatibilidade com
  `eslint-config-next`/`typescript-eslint` e outras ferramentas do
  ecossistema Next.js que podem nao ter acompanhado a mudanca. Ficar em
  `^5.0.0` e uma escolha conservadora, nao uma confirmacao de que 5.x e
  a versao "correta" a longo prazo - revisar quando o ecossistema
  estabilizar em torno do TS7.

## Itens NAO validados por falta de internet neste ambiente

Nada abaixo foi confirmado por uma execucao real (`npm install`,
`npm run build`, `npm run lint`, push para um repositorio remoto, ou
qualquer chamada a uma API externa). Sao decisoes de boa-fe, baseadas em
padroes documentados publicamente, mas que precisam de confirmacao no
seu primeiro `npm install` local:

1. Se as versoes por major listadas em `package.json` realmente
   resolvem para um conjunto de pacotes compativel entre si (sem
   conflito de peer dependencies).
2. Se a sintaxe exata de `next.config.ts`, `postcss.config.mjs` e
   `eslint.config.mjs` usada aqui corresponde exatamente ao que as
   versões finais instaladas esperam (foram escritas com base em
   padroes documentados, sem execucao real para confirmar).
3. Se `eslint-config-next` e `@eslint/eslintrc` resolvem sem conflito
   junto com ESLint 9 flat config.
4. Se as versoes das GitHub Actions usadas no CI
   (`actions/checkout@v4`, `actions/setup-node@v4`) sao as mais atuais
   disponiveis no marketplace - nao houve acesso ao GitHub para
   conferir.
5. Se o `next-env.d.ts` criado manualmente corresponde exatamente ao
   que a versao final do Next.js geraria (normalmente e
   autogerado/sobrescrito no primeiro `next dev`/`next build`).
6. Nenhum `package-lock.json` foi gerado - isso so acontece no primeiro
   `npm install` real.
7. Nenhuma credencial, projeto Supabase ou deploy na Vercel foi criado
   ou testado.

Ate que o item 1 seja confirmado, trate o `package.json` como uma
proposta razoavel, nao como uma configuracao definitiva.

---

## Sprint 1 - Decisoes sobre o protótipo Figma Make

Analise completa (telas, rotas, componentes, dependencias reais vs
instaladas) feita antes de implementar - resumo das decisoes que vieram
dos conflitos identificados e aprovados por voce:

| Conflito | Decisao aprovada |
|---|---|
| Sem tela de login no prototipo | Tela nova, desenhada do zero com os mesmos tokens visuais (nao existe fonte a copiar). |
| Nome real da clinica nao informado | `lib/config/clinic.ts` usa placeholder generico ("Clínica Odontológica"), nao uma marca inventada. Trocar 1 arquivo quando houver o nome real. |
| "Configuracoes" fora do MVP | Removido do menu lateral nesta sprint. |
| "Atendimentos" sem paciente selecionado | Removido do menu lateral - atendimento so sera acessivel a partir do perfil do paciente (Sprint 4). |
| Busca global / sino sem RF correspondente | Mantidos visualmente, desabilitados, sem badge de notificacao falso. |
| ~40 dependencias do prototipo nao usadas por nenhuma tela real (MUI, Radix/shadcn `ui/`, react-router, canvas-confetti, react-dnd, react-slick, masonry, embla, vaul, motion, next-themes, react-hook-form, cmdk, input-otp) | Nenhuma trazida. So `lucide-react` (ja usado por todas as telas) entrou nesta sprint; `recharts` so entrara na Sprint 7 (Financeiro), quando for realmente usado. |
| Navegacao por estado (`useState`), sem URL real | Convertida para rotas de verdade do App Router. |

## Decisoes tecnicas novas desta sprint

- **Sessao via `@supabase/ssr`** (cookies), com refresh no
  `middleware.ts` - resolve a decisao que ficara em aberto na Sprint 0.
- **Protecao de rota em duas camadas independentes**: middleware (edge,
  antes de qualquer render) + `requireUser()`/`requireAdmin()` dentro de
  cada pagina/layout protegido. Nenhuma das duas sozinha seria
  suficiente por padrao do projeto (nunca depender so de uma checagem).
- **RBAC auto-referenciado via funcao `is_admin()` `SECURITY DEFINER`**
  em vez de checar o perfil direto na policy de `usuarios` (evita
  recursao de RLS) - padrao documentado pelo proprio Supabase.
- **Criacao de usuario via convite administrativo** (Supabase Admin
  `inviteUserByEmail`), nao autocadastro - alinhado ao RBAC aprovado
  ("so administrador cria usuario"). A checagem de admin acontece no
  server action, antes de qualquer chamada com a service role key (que
  ignora RLS por definicao).
- **Criar usuario com perfil "dentista" tambem cria o registro
  correspondente em `profissionais`** automaticamente - decisao para
  manter o schema consistente com a relacao 1:1 ja aprovada, evitando
  backfill manual quando a Agenda (Sprint 3) precisar referenciar
  profissionais.
- **Itens de menu sem rota ficam desabilitados ("em breve")**, nao
  viram pagina placeholder nem link morto - concilia "preservar
  identidade visual do prototipo" com "nao criar paginas placeholder
  para todos os modulos futuros" (instrucoes aparentemente conflitantes
  do pedido da Sprint 1; esta foi a sintese escolhida, sinalizada antes
  de implementar).
- **Dashboard desta sprint e uma casca minima**, sem os KPIs/dados
  ficticios do prototipo - copiar aqueles dados criaria aparencia de
  funcionalidade que nao existe (RF-03 completo depende de modulos que
  ainda nao existem).
- **Fonte Inter via `next/font/google`** em vez do link direto ao Google
  Fonts do prototipo - melhoria tecnica padrao do Next.js (auto-hospeda
  a fonte, elimina dependencia de rede em runtime e flash de fonte).
- **Modo escuro do prototipo nao foi portado** - nao e requisito do MVP;
  evita CSS morto.

## Tentativa de validacao nesta sprint (lint/build)

Com o projeto completo, tentei rodar `npm install`, `npm run lint` e
`npm run build` neste ambiente, como pedido. Resultado exato:

- `npm install`: falhou de fato, comando executado nesta sprint.
  Saida real: `npm error code E403` / `403 Forbidden - GET
  https://registry.npmjs.org/@eslint%2feslintrc`. Confirma de novo a
  mesma restricao de rede do Sprint 0.
- `npm run build`: executado, saida real: `sh: 1: next: not found`
  (esperado - sem `node_modules`).
- `npm run lint`: executado, saida real: `sh: 1: eslint: not found`
  (esperado - sem `node_modules`). TypeScript e React estao disponiveis
  globalmente neste ambiente, mas rodar `tsc` contra o projeto usando
  apenas os pacotes globais resolveria os tipos do `react` e nada mais -
  `next/navigation`, `next/headers`, `@supabase/ssr`, `lucide-react` não
  seriam encontrados de qualquer forma, entao o erro seria sobre
  dependencia ausente, nao sobre um problema real de tipo. Preferi nao
  rodar essa validacao parcial para nao dar a falsa impressao de que o
  codigo foi conferido quando na pratica so confirmaria a mesma
  limitacao de rede ja conhecida.
- **O que isso significa na pratica**: todo o codigo desta sprint foi
  revisado manualmente (imports, tipos, convencoes do App Router,
  Server/Client Component boundaries), mas **nenhuma linha foi
  compilada ou executada de fato**. O primeiro `npm install` +
  `npm run build` local e o verdadeiro teste - qualquer erro de digitacao
  ou import incorreto só aparecerá nesse momento.

## Itens NAO validados por falta de internet neste ambiente (atualizado)

Alem dos itens ja listados na Sprint 0 (que continuam validos), a Sprint
1 adiciona:

8. Se `@supabase/ssr` versao `^0.10.0` e de fato compativel com Next 16
   App Router (API `createServerClient`/`createBrowserClient` usada
   aqui) - baseada em padrao documentado publicamente, nao testada.
9. Se `useActionState` (React 19) funciona exatamente como escrito nos
   formularios (`app/login/LoginForm.tsx` e afins) sem ajuste.
10. Se a migration `0001_usuarios_profissionais.sql` roda sem erro de
    sintaxe/permissao no Postgres real do Supabase - nunca foi executada.
11. Se o ícone `Cross` existe na versao final do `lucide-react` que for
    instalada (existia na versao usada pelo prototipo).
12. Fluxo de convite (`inviteUserByEmail`) e de recuperacao de senha
    dependem de configuracao de e-mail (SMTP) e Redirect URLs no painel
    do Supabase, que nao existem neste ambiente - ver checklist em
    `docs/DEPLOYMENT.md`.
