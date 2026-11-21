# Sprint 2.1 — confiabilidade da referência de pagamento (F1)

## Objetivo e aceite

Impedir que falhas ao consultar atendimentos e orçamentos convertam um vínculo solicitado ou selecionado em pagamento somente do paciente. A interface deve mostrar carregamento, lista vazia, sucesso, falha HTTP, falha de rede e perda de sessão; oferecer nova tentativa; bloquear envio ambíguo; exigir confirmação explícita para pagamento sem referência. A ação deve recusar ausência dessa confirmação e referência malformada. Os testes usam apenas dados fictícios e mocks locais.

## Estado e contrato

- Auditoria: `docs/AUDITORIA_PRODUTO_ODONTO_CLASS.md`, item F1.
- Fluxo: `PaymentForm.tsx` → `/api/financeiro/referencias` → RPC `list_payment_references`; submissão por `registerPayment` → RPC `create_payment`.
- Antes da correção, falha HTTP era traduzida em `references: []` e falha de rede chamava `setReference("none")`.
- `create_payment` na migration histórica `0012_financeiro_pagamentos.sql` valida papel financeiro ativo, paciente ativo, orçamento aprovado e vínculo de atendimento/orçamento com o paciente; RLS proíbe escrita direta em `pagamentos`. O formulário acrescenta confirmação operacional; a RPC continua a autoridade para os vínculos.
- Worktree inicial tinha arquivos preexistentes não rastreados; nenhum deles foi alterado por esta sprint. Estado de QA/Production não verificado nesta execução, por restrição expressa.

## Escopo e implementação

| Arquivo | Responsabilidade |
| --- | --- |
| `app/(app)/financeiro/PaymentForm.tsx` | Estados, seleção preservada, confirmação, feedback e retry |
| `app/(app)/financeiro/actions.ts` | Validação de entrada e confirmação no servidor, guard de papel |
| `app/api/financeiro/referencias/route.ts` | Respostas distinguíveis de sessão e falha, sem alterar a RPC |
| `lib/financial/payment-reference-loader.ts` | Interpretação das respostas da busca |
| Testes próximos aos módulos | Regressão local de falhas, seleção e submissão |

Nenhuma migration, mudança de RLS, instalação, operação remota ou alteração das regras financeiras de valor e status. Recebíveis (`ReceivableForm`) permanecem fora de F1; a duplicação de busca é D2 na auditoria.

## Segurança e compatibilidade

O navegador não é fonte de autorização. A ação confere sessão/papel, formato dos campos e confirmação explícita; a RPC verifica a referência no banco e executa o registro numa transação. O paciente pode continuar recebendo pagamento sem referência quando o operador confirma essa escolha. Erros da consulta não apagam a referência selecionada. O status do carregamento bloqueia a submissão enquanto a lista não foi obtida com êxito. A rota não devolve dados clínicos no erro.

## Estados da busca e resposta operacional

| Estado | Resposta do formulário |
| --- | --- |
| Carregando | Seleção e envio indisponíveis; referência atual preservada |
| Sucesso | Opções exibidas; vínculo válido pode ser enviado |
| Vazio | Mensagem específica; somente paciente exige checkbox de confirmação |
| Erro HTTP ou resposta inválida | Erro visível, envio bloqueado e botão de nova tentativa |
| Erro de rede | Mensagem de conexão, envio bloqueado e nova tentativa |
| Perda de sessão | 401 ou redirecionamento do proxy identificado; envio bloqueado e orientação para entrar novamente |
| Referência solicitada ausente após sucesso | Valor permanece visível como indisponível; operador escolhe outra ou confirma explicitamente “somente paciente” |

O `select`, o checkbox e o botão de retry são controles nativos acessíveis por teclado. O feedback é associado ao `select` por `aria-describedby`, com `role="alert"` nos erros. A revisão estática não substitui um teste de navegador com leitor de tela/teclado.

## Validação e pendências

- `npm run lint`: passou, sem avisos na execução final.
- `npm run typecheck`: passou.
- `npm test`: 56 arquivos passaram, 334 testes passaram, 1 skipped. Testes focados da mudança: 11 casos passaram, inclusive redirecionamento do proxy.
- `npm run build`: passou com Next.js 16.3.8.
- `git diff --check`: passou.
- Revisão independente `security_reviewer`: PASS local após correção do risco de conservar referência anterior quando a URL muda para outro orçamento do mesmo paciente. Revisor confirmou teste de navegação, guard de papel, confirmação e autoridade da RPC.

Integração PostgreSQL, QA e Production permanecem fora desta rodada. Não foi feita verificação visual/teclado em navegador porque o ambiente local configurado não foi comprovado isolado do backend remoto. S1 não é declarada homologada. Nenhuma migration foi aplicada. O risco residual é não ter prova fim a fim de RLS/RPC e da interação real por teclado nesta sprint local.
