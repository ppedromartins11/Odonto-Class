# Classificação independente do ambiente remoto

Data da consulta: 06/10/2026 (America/Cuiaba). Escopo: consultas autenticadas somente leitura aos metadados de Supabase e Vercel, vínculo local do CLI e configuração de CI/deploy. Nenhuma variável secreta foi registrada neste relatório.

## Resultado

**ENVIRONMENT_CLASSIFICATION: BLOCKED**  
**TARGET:** Supabase ref `sqouddqzpmkofenyufuj`  
**Constatação administrativa:** esse ref está configurado em uma variável de ambiente de **Production** do projeto Vercel `odonto-class`. Também aparece na configuração de Preview. Portanto, a condição `TARGET != PRODUCTION` não foi demonstrada; o alvo deve ser tratado como conectado a Production para qualquer decisão de limpeza. A configuração não prova tráfego ativo ou a natureza dos dados armazenados, mas impede classificar o projeto como exclusivamente QA.

| Fonte | Evidência somente leitura | Limite |
| --- | --- | --- |
| Supabase, `get_project` e `list_projects` autenticados | Ref `sqouddqzpmkofenyufuj`, nome `clinica`, organização `saofalxliiqeaaxsrqqt`, estado `ACTIVE_HEALTHY`. Há outro projeto na mesma organização, ref `qprzxkolbbnqfopamfhj`, nome `odonto-class-dr-test`. | Nomes não certificam finalidade nem exclusão de Production. |
| Vercel, projeto autenticado `odonto-class` | Projeto `prj_VVGLeGUV0RLesUPJ1QVJw3dt4Iqu`. A variável `NEXT_PUBLIC_SUPABASE_URL` de Preview tem ID `iofyRXzYrcCdOZdr`; a de Production tem ID `QWJyXqjwiPKHcWdI`. As duas URLs foram comparadas em memória com a URL canônica do ref alvo: **Preview = alvo, Production = alvo, Preview = Production**. Nenhum valor foi impresso ou gravado. | Vínculo de configuração, não comprovação de tráfego. O campo `live` do projeto retornou `false`; a implantação mais recente estava `READY`, com `target` nulo. Esses campos não anulam o vínculo de Production. |
| CLI Supabase local | `supabase/.temp/project-ref` contém `sqouddqzpmkofenyufuj`. | Demonstra o alvo efetivo do CLI, não a classe do ambiente. |
| Repositório | `.github/workflows/ci.yml` define job `integration` com GitHub environment `homologacao-ficticia` e nomes de secrets de teste. `docs/DEPLOYMENT.md` pede projeto Supabase exclusivo de homologação e variáveis Vercel separadas por Preview/Production. Não há `.vercel/project.json` local. | Nome do environment e documentação não vinculam secret a ref; o texto de deploy contém estados históricos de migrations. |
| GitHub administrativo | `gh` não está disponível neste host; o conector GitHub disponível não oferece consulta aos metadados de environments/secrets. | Não foi verificado mapeamento de secrets GitHub para project ref. Nenhum valor de secret é necessário para esta decisão, pois o vínculo Vercel Production já bloqueia a classificação. |

O guard do runner valida coerência entre URL, banco e ref vinculado, mas uma declaração local de `homologation` ou lista vazia de refs Production não é autoridade independente. **REMOTE_CLEANUP_GATE: BLOCKED**, independentemente do resultado do fechamento de ownership.

## Ação administrativa necessária

1. No Vercel, abra o projeto `odonto-class` → Settings → Environment Variables e verifique `NEXT_PUBLIC_SUPABASE_URL` separadamente em **Production** e **Preview**. Confirme a qual ref Supabase cada alvo pertence, sem enviar valores de chaves, connection strings ou URLs completas.
2. Defina e documente, sob uma autoridade administrativa separada do runner, qual ref é Production e qual projeto é dedicado exclusivamente a QA/homologação. O ref `sqouddqzpmkofenyufuj` não pode ser liberado como QA enquanto estiver vinculado ao alvo Production. Caso QA deva usar outro projeto, faça a separação de vínculos como uma operação própria, revisada e autorizada; esta investigação não altera configurações.
3. Verifique também se o GitHub environment `homologacao-ficticia` e os deployments de Preview usam o ref de QA declarado. Registre apenas refs e escopos de ambiente, sem valores secretos.
4. Depois da separação, repita a consulta administrativa Vercel/Supabase e o inventário remoto no **novo alvo QA**. O gate só poderá passar se houver prova positiva de exclusividade QA e de exclusão de Production, além dos demais gates de ownership.

## Controle durável proposto

Mantenha um registro de classificação de projetos controlado pela equipe proprietária, fora do processo de homologação: organização, ref, classe (`production`, `qa`, `dr-test`), projeto Vercel, escopos de ambiente, responsável e data de revisão. Publique uma declaração assinada ou exponha o registro por identidade administrativa de **leitura apenas**. O runner deve falhar se o ref não estiver cadastrado como QA, se estiver marcado Production, se a declaração estiver vencida, ou se a leitura atual das variáveis Vercel indicar o ref em Production. A identidade que assina/edita o registro deve ser distinta da identidade que executa o cleanup. Um label escrito pelo próprio runner não constitui prova.
