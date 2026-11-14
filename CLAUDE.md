# AGENTS.md — Odonto Class

Sistema de gestão para clínica odontológica real.

Este arquivo contém regras permanentes para agentes Codex trabalhando neste repositório.

## Fontes de verdade

Antes de implementar mudanças relevantes, consulte os documentos relacionados:

- requisitos: `docs/REQUIREMENTS.md`
- decisões: `docs/DECISIONS.md`
- arquitetura: `docs/ARCHITECTURE.md`
- banco: `docs/DATABASE.md`
- segurança/LGPD: `docs/SECURITY.md`
- histórico: `docs/CHANGELOG.md`

Não invente requisitos.

Se houver conflito entre documentação e implementação, investigue antes de alterar.

## Workflow

Para tarefas não triviais:

```text
INVESTIGAR -> PLANEJAR -> IMPLEMENTAR -> TESTAR -> REVISAR -> DOCUMENTAR
```

Antes de modificar:

1. localize a implementação existente;
2. leia os arquivos relacionados;
3. procure padrões semelhantes no projeto;
4. examine testes existentes;
5. examine banco/RLS quando aplicável.

Nunca especule sobre código que não foi inspecionado.

Para mudanças pequenas, não gere planejamento burocrático.

Para mudanças grandes envolvendo banco, segurança, arquitetura, prontuário ou financeiro, determine antes:

- arquivos afetados;
- fluxo atual;
- fluxo desejado;
- banco/RLS afetados;
- riscos;
- testes necessários.

## Escopo

Implemente somente o necessário para atender à tarefa.

Evite:

- funcionalidades não solicitadas;
- campos "para uso futuro";
- abstrações prematuras;
- dependências desnecessárias;
- refatorações não relacionadas;
- páginas placeholder;
- mocks apresentados como funcionalidade real.

Melhorias fora do escopo podem ser reportadas separadamente.

## Pontos ambíguos

Não invente regras de negócio.

Se uma ambiguidade puder alterar:

- regra de negócio;
- banco;
- autorização;
- segurança;
- financeiro;
- comportamento clínico;
- escopo aprovado;

marque como:

```text
PONTO A VALIDAR
```

PAV-03 a PAV-08 e PAV-19 permanecem em aberto e não devem ser resolvidos unilateralmente.

## Regras críticas

### RN-02

Não pode existir conflito de horário para o mesmo profissional.

Encaixe está fora do MVP conforme PAV-13.

### RN-05

Autorização deve ser aplicada no backend/RLS.

Nunca dependa apenas da interface.

Funcionalidades clínicas e financeiras precisam de teste de autorização além do teste funcional.

### RN-09

Desenvolvimento, testes e seeds devem utilizar somente dados fictícios.

### Exclusão

Paciente e prontuário não devem sofrer exclusão física.

Use exclusão lógica (`ativo=false`) conforme PAV-17.

## Decisões aprovadas

Não reabra sem solicitação explícita:

- PAV-09: documento do paciente opcional, sem validação de formato.
- PAV-10: pagamento vincula atendimento OU orçamento, nunca ambos.
- PAV-11: itens de orçamento permanecem em texto livre nesta fase.
- PAV-12: validade/esterilização seguem decisão registrada em `DECISIONS.md`.
- PAV-13: sem encaixe no MVP.
- PAV-14: confirmação de consulta manual.
- PAV-15: `atendimentos.agendamento_id` opcional.
- PAV-16: FDI é a notação proposta; campo legado permanece texto livre.
- PAV-17: sem exclusão física de prontuário.
- PAV-18: auditoria incremental por sprint.
- PAV-20: MFA obrigatório para administrador antes do go-live.
- PAV-21: financeiro gerencial restrito ao administrador.

Para detalhes, consulte `docs/DECISIONS.md`.

## Banco e migrations

Antes de alterar banco, examine:

- migrations relacionadas;
- FKs;
- constraints;
- indexes;
- triggers;
- RPCs;
- grants;
- RLS.

Toda tabela nova deve nascer com RLS habilitada na mesma migration.

Prefira migrations aditivas.

Não altere migrations históricas já aplicadas quando uma nova migration puder representar a mudança.

Não execute alterações destrutivas silenciosamente.

## Supabase / autorização

Toda página protegida deve utilizar as proteções server-side estabelecidas, como:

- `requireUser()`
- `requireAdmin()`
- gates AAL2 existentes

O proxy não substitui autorização server-side.

RLS continua obrigatória quando aplicável.

Operações usando `lib/supabase/admin.ts` devem validar autorização ANTES de utilizar service role.

Nunca exponha service role no cliente.

## Segurança

Quando aplicável, revise:

- autenticação;
- autorização;
- RLS;
- IDOR;
- escalada de privilégio;
- validação server-side;
- exposição de dados;
- arquivos privados;
- secrets;
- logs sensíveis.

Nunca enfraqueça segurança apenas para fazer um teste passar.

## Next.js

Não assuma APIs do Next.js pela memória.

Determine a versão instalada e consulte:

```text
node_modules/next/dist/docs/
```

quando a tarefa depender do comportamento do framework.

Preserve o bloco `nextjs-agent-rules` gerenciado pelo Next.js quando ele existir.

## Convenções

Banco:

- nomes em português;
- `snake_case`;
- seguir `docs/DATABASE.md`.

Código:

- TypeScript/React em inglês;
- evitar `any`;
- reutilizar padrões existentes;
- evitar abstração sem necessidade.

Pacotes:

```text
npm
```

Não adicione dependência antes de verificar se o projeto já possui solução equivalente.

## Git

Antes de alterar:

```bash
git status
```

Não sobrescreva trabalho existente do usuário.

Não utilize comandos destrutivos como:

```bash
git reset --hard
git clean -fd
```

sem autorização explícita.

Não faça force push.

## Testes e validação

Use os scripts realmente existentes em `package.json`.

Quando aplicável:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Antes de concluir:

- revise o diff;
- remova logs temporários;
- remova mocks acidentais;
- verifique secrets;
- valide autorização;
- valide RLS;
- execute testes relevantes.

Não declare que algo passou se não foi realmente executado.

## Documentação

Atualize documentação apenas quando a mudança produzir conhecimento que deve permanecer entre sessões.

Principalmente:

- `docs/CHANGELOG.md`
- `docs/DECISIONS.md`
- `docs/DATABASE.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`

Não transforme uma decisão temporária do agente em decisão permanente.

## Definition of Done

Uma tarefa está concluída quando, quando aplicável:

```text
[ ] requisito atendido
[ ] escopo respeitado
[ ] autorização validada
[ ] RLS validada
[ ] testes passando
[ ] lint passando
[ ] typecheck passando
[ ] build passando
[ ] diff revisado
[ ] sem secrets
[ ] documentação necessária atualizada
```

## Relatório final

Ao concluir, informe de forma objetiva:

### Implementado
O que mudou.

### Arquivos principais
Somente os arquivos relevantes.

### Validação
Comandos executados e resultados reais.

### Banco
Migration/RLS quando aplicável.

### Pendências
Somente pendências reais.

## Regra final

Prefira a menor alteração correta, segura e testada.

Investigue antes de modificar e não introduza comportamento que não tenha sido solicitado ou documentado.