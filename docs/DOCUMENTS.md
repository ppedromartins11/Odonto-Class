# Documentos oficiais Odonto Class

## Escopo

A migration `0019_documentos_oficiais.sql` padroniza atestado odontológico,
declaração de comparecimento, declaração de acompanhamento e versões emitidas
do PDF de orçamento. Registros legados `atestado` e `declaracao` permanecem
legíveis e seus binários privados não são convertidos nem regenerados.

## Autoria e preparação

- Atestado: somente dentista ativo, com CRO preenchido, autor do atendimento e
  autenticado como o próprio profissional.
- Declarações: dentista pode emitir a própria; administrador ou recepção podem
  preparar quando o autor estiver realmente vinculado ao atendimento.
- `documentos.profissional_id` é o autor profissional. `created_by` é o ator
  operacional/preparador. Não existe seleção livre de autor.
- Documento preparado por não dentista recebe a indicação “PREPARADO PARA
  ASSINATURA FÍSICA”. A aplicação não oferece assinatura digital.

## CID e minimização

CID é opcional e ausente por padrão. Somente atestado aceita CID. Quando
informado, a RPC exige autorização afirmativa, tipo do autorizador e registra
data/ator no servidor. O código fica em `documento_cid`, separado de
`documentos`, e a RLS permite leitura somente ao dentista autor. O valor nunca
entra em auditoria, log, mensagem, nome de arquivo ou path de Storage.

Declarações não recebem diagnóstico, CID ou evolução. Acompanhamento exige
somente nome; identificação mínima e relação são opcionais.

## PDFs e snapshots

O núcleo em `lib/documents/` usa `pdf-lib`, A4, logo PNG com alfa real, header,
footer paginado, datas/moeda pt-BR, quebras de página e assinatura física.
Somente dados existentes em `lib/config/clinic.ts` são impressos.

Documentos do paciente são gerados no servidor, enviados ao bucket privado
`arquivos-paciente` com `upsert: false`, registrados pela RPC
`create_official_document` e recebem `layout_version` e SHA-256 do binário
efetivamente enviado. Falha no metadado remove apenas o upload recém-criado.

`orcamento_pdf_versoes` guarda metadados de cada emissão. “Emitir PDF” cria a
versão 1; “Emitir nova versão” cria N+1 sob lock. Download recupera o mesmo
binário da versão escolhida. Não existe overwrite nem regeneração silenciosa.

## Storage e download

Paths usam apenas UUID:

- `{paciente_uuid}/documentos/{arquivo_uuid}.pdf`
- `{orcamento_uuid}/orcamentos/{arquivo_uuid}.pdf`

O bucket permanece privado e sem policy direta para `authenticated`. A rota
consulta metadados sob RLS e só então cria URL assinada de cinco minutos com
service role exclusivamente no servidor. A URL não é persistida.

## Eventos de auditoria

`documento_emitido`, `documento_preparado` e `orcamento_pdf_emitido` registram
somente IDs, tipo, autor/preparador, atendimento, versão e layout. Conteúdo,
CID, finalidade integral, diagnóstico e dados do acompanhante não são copiados.

## Referências normativas

- Lei 5.081/1966, art. 6º, III.
- Código de Ética Odontológica do CFO.
- Manual do Prontuário do CFO (2026) e seus modelos anexos.

