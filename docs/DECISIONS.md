# Registro de Decisoes (ADR resumido)

## PAV-25 - Odontograma FDI da Sprint 14

- A primeira versão relaciona 0..N dentes permanentes FDI ao procedimento; não
  modela faces, condições, diagnóstico, periodonto ou dentição infantil.
- `procedimentos.dente` permanece como texto legado e não sofre conversão ou
  interpretação automática.
- Somente o dentista ativo responsável altera dentes enquanto o atendimento
  está em andamento; finalização torna a seleção histórica e imutável.
- Quantidade clínica, valor e consumo de estoque são independentes do número
  de dentes selecionados.

## PAV-23 - Estoque simples da Sprint 12

- Estoque e compartilhado pela clinica; nao ha propriedade de material por dentista, setor ou profissional.
- Recepcao registra entradas e saidas; dentista registra somente saida/consumo manual com motivo obrigatorio; ajuste e cadastro administrativo sao exclusivos do administrador.
- Historico e completo para administrador/recepcao e restrito as proprias movimentacoes para dentista. Movimentacoes sao append-only.
- Ajuste representa a nova contagem fisica, pode resultar em zero e exige motivo. Entrada/saida exigem quantidade positiva.
- Alertas de estoque baixo, vencendo e vencido sao calculados, podem coexistir e nao escondem um ao outro. A janela de vencimento e de 30 dias.
- Procedimentos continuaram sem movimentacao automatica na Sprint 12.

## PAV-24 - Servicos e consumo configuravel da Sprint 13

- Catalogo de servicos e administrativo: somente administrador cria, altera,
  ativa, inativa e configura materiais.
- Dentista ativo seleciona somente servicos ativos ao registrar procedimento
  no proprio atendimento; recepcao e administrador puro nao acessam conteudo
  clinico por esse caminho.
- Valor aplicado e composicao de materiais sao snapshots no procedimento.
  Alteracoes posteriores de preco ou composicao nao alteram historico.
- Consumo automatico ocorre somente ao finalizar atendimento, em uma unica
  transacao com saldo suficiente. Material inativo, saldo insuficiente ou
  tentativa duplicada abortam integralmente a operacao.

## PAV-22 - Orcamentos comerciais da Sprint 10

- A migration `0011` e independente do WIP `0007/0008`; nenhuma migration
  historica e reescrita.
- `validade_em` pode ser nula em rascunho. Envio exige validade e ao menos um
  item ativo com total positivo. Orcamento enviado vencido e tratado como
  expirado pelo servidor, sem cron, e nao pode ser aprovado.
- `convertido` e somente estado comercial. Nao cria automaticamente
  atendimento, procedimento, pagamento ou tratamento.
- PDF de orcamento e entregue sob demanda por rota autenticada; nao ha bucket,
  URL assinada persistida ou conteudo administrativo em auditoria.

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

Itens ainda abertos: PAV-03 a PAV-08.

## PAV-19 - upload de arquivos (aprovada)

- Bucket privado `arquivos-paciente`; nunca publico.
- PDF, JPEG e PNG somente, com validacao server-side de MIME, extensao e limite de 10 MiB.
- Categorias fechadas: `administrativo` e `clinico`; paths usam UUID e nao contem PII.
- Download ocorre somente por rota autenticada/autorizada, com signed URL de cinco minutos que nao e persistida.
- Sem overwrite; remocao e logica, auditada e sem purga automatica.

## Sprint 1.5 - decisoes aprovadas de seguranca

| Tema | Decisao aprovada |
|---|---|
| RBAC (PAV-01/PAV-02) | Negacao por padrao. Admin ativo gerencia usuarios e consulta auditoria; dentista e recepcao leem o proprio perfil; somente usuario ativo lista profissionais. Cada modulo futuro deve adicionar a propria matriz por acao/campo antes da migration, sem herdar acesso generico. |
| Auditoria (PAV-18) | Antes de dados clinicos, registrar: convite/aceite, ativacao/desativacao, mudanca de perfil, tentativa administrativa negada, redefinicao de senha e mudanca de configuracao de acesso. Eventos clinicos serao adicionados junto do modulo correspondente. |
| MFA (PAV-20) | Obrigatorio para administrador antes do go-live. Nao bloqueia validacao local, mas bloqueia producao enquanto configuracao e teste AAL2 nao estiverem concluidos. |
| Financeiro da recepcao (PAV-21) | Acesso operacional necessario para registrar e consultar pagamentos do atendimento; sem indicadores agregados, resultado ou visao gerencial da clinica. |
| Pagamento pago (Sprint 11) | Valor, forma, data e vinculo nao sao editados depois do registro. Correcao ocorre por cancelamento ou estorno administrativo, preservando historico e auditoria. |
| Desativacao | Bloquear dados imediatamente por `usuarios.status`/RLS e suspender a conta Auth. Tokens ainda validos nao concedem dados; reativacao remove a suspensao e so entao restaura status, com compensacao em caso de falha. |
| Ultimo administrador | Nao permitir autodesativacao/autodowngrade nem qualquer mudanca que deixe zero administradores ativos. Regra atomica no banco, nao somente na UI. |
| Profissional | Ao mudar para dentista, criar/reativar `profissionais`; ao sair do perfil ou desativar, preservar o historico e inativar o registro. |
| Provisionamento | Convite carrega metadados assinados pelo contexto administrativo; trigger provisiona `auth.users` -> `usuarios` -> `profissionais` + auditoria na mesma transacao. |

## Sprint 1.5 - decisoes tecnicas

- Runtime suportado: Node.js 24 (`engines`, `.node-version` e CI).
- ESLint 9 usa flat config nativo do `eslint-config-next` 16.
- `middleware.ts` foi substituido por `proxy.ts`; cookies e headers
  devolvidos pelo `setAll` do `@supabase/ssr` sao preservados inclusive
  nos redirects.
- Convite e recuperacao terminam em handlers SSR/PKCE. A pagina de nova
  senha exige sessao Supabase e cookie HttpOnly assinado, valido por 10
  minutos e vinculado ao usuario/fluxo.
- `is_admin()` e `is_active_user()` sao `SECURITY DEFINER`, usam
  `search_path = ''`, nomes qualificados e `EXECUTE` somente para
  `authenticated`/roles tecnicas necessarias.
- `package-lock.json` e artefato versionado; `.env.local.example` contem
  somente placeholders.

## Sprint 2 - Pacientes

| Tema | Decisao aprovada |
|---|---|
| Cadastro | Nome obrigatorio; data de nascimento, telefone e documento opcionais. Data nao pode estar no futuro; documento nao tem formato obrigatorio. |
| Busca | Server-side e paginada por nome acento-insensivel ou telefone normalizado. Documento fica fora. |
| Dado clinico | `paciente_alertas_clinicos` 1:1 separa alergias, intolerancias e medicamentos da entidade administrativa; apenas retrato atual. |
| Acesso clinico | Somente dentista ativo com profissional ativo. Administrador puro e recepcao nao recebem acesso clinico. Multiplo papel admin+dentista fica pendente se a clinica realmente precisar. |
| Status/exclusao | Somente administrador inativa/reativa; nenhuma exclusao fisica pela aplicacao. |
| Auditoria | Criacao, atualizacao, status e mudanca de alertas; apenas IDs e nomes de campos, sem valores sensiveis. Leituras nao sao auditadas nesta fase. |
| Escopo | Sem observacao generica, prontuario, agenda, atendimento, documento, financeiro, arquivo ou outro modulo futuro. |

## Bloco clinico integrado - decisoes aplicadas

| Tema | Decisao |
|---|---|
| Consulta/agendamento | Uma unica entidade `agendamentos`; nao existe tabela duplicada de consulta operacional. |
| Conflito | Exclusion constraint GiST no banco, rigida e concorrente; sem encaixe (PAV-13). |
| Remarcacao | Preserva o mesmo ID e registra antes/depois na auditoria; se estava confirmado, volta a agendado para nova confirmacao. |
| Atendimento direto | Permitido com `agendamento_id` nulo (PAV-15). |
| Acesso clinico | Papel unico vigente: apenas dentista ativo acessa os proprios atendimentos. Admin puro e recepcao recebem zero linhas. |
| Evolucao historica | Editavel apenas em andamento. Finalizacao torna o registro e seus procedimentos imutaveis; sem apagamento silencioso. |
| Dente/regiao | Campo `dente` textual opcional preservado; a Sprint 14 adiciona vínculo FDI estruturado separado, sem migrar o legado (PAV-16/PAV-25). |
| Procedimentos (base 0004) | Texto simples sem odontograma ou exclusao fisica; a Sprint 13 adiciona opcionalmente catalogo e consumo snapshotado. |
| Fuso | Entrada e visualizacao em `America/Cuiaba`; persistencia em `timestamptz`. |
| Dependencias | Agenda responsiva implementada sem biblioteca externa de calendario. |

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

## Estado de validacao atualizado na Sprint 1.5

- Dependencias foram instaladas e `package-lock.json` foi gerado.
- ESLint/Next 16, tipos, testes unitarios e build foram executados com
  sucesso em Node.js 24.
- Migrations `0001`/`0002`, lint SQL e sete testes RLS passaram em
  Supabase de homologacao com dados ficticios em 22/08/2026. Como a
  `0001` havia sido aplicada manualmente sem historico, o catalogo foi
  comparado e sua versao foi reparada como `applied` antes do push da
  `0002`.
- SMTP, Redirect URLs e MFA/AAL2 tambem exigem validacao no painel do
  ambiente de homologacao antes do go-live.

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

- **Sessao via `@supabase/ssr`** (cookies), originalmente com refresh no
  middleware e migrada para `proxy.ts` na Sprint 1.5.
- **Protecao de rota em duas camadas independentes**: proxy,
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

## Validacao posterior do codigo da Sprint 1

As incompatibilidades que nao puderam ser verificadas no ambiente
original foram resolvidas e testadas na Sprint 1.5. Permanecem externos
somente a execucao do banco/RLS, SMTP/redirects e MFA descritos no gate
acima.

## Sprint 15 - decisoes de Validade, lotes e esterilizacao

- `controle_validade` e legado/WIP historico: permanece no schema, sem UI e
  sem ser fonte de verdade do novo modulo.
- Saldo do lote e saldo fisico; `materiais_estoque.quantidade_atual` e o
  agregado. Toda RPC controlada atualiza ambos e valida o invariante.
- Ativar controle em material com saldo exige lote inicial explicito. A
  desativacao so e permitida com todos os lotes e o agregado zerados.
- Vencimento nao movimenta estoque: o lote segue fisicamente registrado, mas
  fica indisponivel para uso normal. Descarte/perda exigem finalidade e motivo.
- FEFO e a baixa clinica por lote ficaram para Sprint especifica. Ate la,
  atendimento com material controlado e bloqueado antes de qualquer escrita.
- Validade de pacote e informada pelo operador, deve ser posterior ou igual a
  esterilizacao e e calculada com `America/Cuiaba`.
- Admin gerencia tudo; recepcao opera entradas/saidas/ciclos/pacotes sem ajuste
  administrativo; dentista possui somente leitura operacional.
- Metadados de equipamento podem ser corrigidos pelo administrador, inclusive
  quando inativo. Ativacao/inativacao continua RPC separada; ciclos historicos
  exibem o cadastro atual por JOIN, sem snapshot retroativo nesta Sprint.

## Documentos oficiais - decisões da migration 0019

- `profissional_id` continua sendo o autor e `created_by` o preparador; não se
  criam colunas redundantes.
- Todo novo documento exige atendimento real do mesmo paciente e autor.
- CID fica em tabela clínica separada e nunca é visível a admin/recepção.
- Assinatura é física. Não há imagem, desenho, ICP-Brasil ou alegação de
  assinatura digital.
- O PDF privado é o snapshot oficial. SHA-256 e layout versionam a emissão;
  dados atuais não alteram downloads históricos.
- A emissão de orçamento é explícita e cria versão N+1. A rota antiga deixa de
  gerar conteúdo atual silenciosamente e baixa somente versão já emitida.
