# Deploy

## Ambiente de geracao (este sandbox)

Este projeto foi montado em um ambiente sem acesso a internet. Isso
significa que `npm install`, criacao de repositorio remoto, criacao do
projeto Supabase e o deploy real na Vercel **nao foram executados
aqui** - ver `docs/DECISIONS.md` para a lista completa de itens nao
validados.

## Checklist para concluir a Sprint 0 (fora deste ambiente)

1. **Instalar dependencias e validar o build:**
   ```
   npm install
   npm run dev
   ```
   Abrir `http://localhost:3000` e confirmar que a pagina placeholder
   aparece sem erros. Rodar tambem `npm run lint` e `npm run build`.

2. **Criar o repositorio remoto** (GitHub, ou outro host de sua
   preferencia - o workflow de CI atual assume GitHub Actions):
   ```
   git remote add origin <url-do-seu-repositorio>
   git push -u origin main
   ```

3. **Criar o projeto no Supabase** (supabase.com) e copiar, em
   Project Settings > API: URL, anon key e service role key.

4. **Preencher `.env.local`** (nunca commitar este arquivo):
   ```
   cp .env.local.example .env.local
   ```
   e colar os valores copiados no passo 3.

5. **Conectar o repositorio na Vercel** (Import Project, apontando para
   o repositorio criado no passo 2) e adicionar as mesmas variaveis de
   ambiente do passo 4 nas configuracoes do projeto na Vercel. A
   importacao ja dispara automaticamente o primeiro deploy - isso e o
   "deploy vazio de teste" da Sprint 0. Nao e necessario usar a CLI da
   Vercel para isso.

6. Confirmar que a URL publica gerada pela Vercel mostra a mesma pagina
   placeholder validada no passo 1.

## Backup e recuperacao (RNF-07)

A definir formalmente quando o banco definitivo existir (Sprint 1 em
diante): a politica de backup do plano Supabase escolhido deve ser
revisada e um teste de restauracao deve ser feito antes de qualquer uso
com dados reais.

## Estado na Sprint 0

Nenhum deploy real foi realizado a partir deste ambiente. O checklist
acima e o unico caminho para concluir esse item.
