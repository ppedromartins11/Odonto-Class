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
