begin;

-- A private, short-lived proof binds the bytes checked by the application
-- server to the authenticated user's subsequent metadata RPC. The server
-- must upload with upsert=false, read the stored object back, and compute
-- SHA-256 and byte length from that readback before preparing this proof.
create schema document_private;
revoke all on schema document_private from public, anon, authenticated, service_role;

create table document_private.upload_attestations (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.usuarios(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  -- Closed purpose tag: document:<tipo_documento> or file:<categoria>.
  purpose text not null check (purpose in (
    'document:atestado', 'document:declaracao_comparecimento',
    'document:declaracao_acompanhamento', 'file:administrativo', 'file:clinico'
  )),
  bucket_id text not null check (bucket_id = 'arquivos-paciente'),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 10485760),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  constraint upload_attestation_short_lived check (
    expires_at > created_at and expires_at <= created_at + interval '2 minutes'
  )
);
alter table document_private.upload_attestations enable row level security;
revoke all on document_private.upload_attestations from public, anon, authenticated, service_role;
create index upload_attestations_expires_at_idx
  on document_private.upload_attestations (expires_at);

-- Existing rows remain readable and soft-deletable. Only a new row or a
-- deliberate patient/path change must satisfy the namespace invariant.
create function document_private.assert_patient_storage_namespace()
returns trigger language plpgsql set search_path = '' as $$
begin
  if split_part(new.storage_path, '/', 1) is distinct from new.paciente_id::text then
    raise exception 'Caminho de arquivo nao corresponde ao paciente.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function document_private.assert_patient_storage_namespace()
  from public, anon, authenticated, service_role;

create trigger documentos_patient_storage_namespace
  before insert or update of paciente_id, storage_path on public.documentos
  for each row execute function document_private.assert_patient_storage_namespace();
create trigger arquivos_paciente_storage_namespace
  before insert or update of paciente_id, storage_path on public.arquivos_paciente
  for each row execute function document_private.assert_patient_storage_namespace();

alter table public.arquivos_paciente
  add column sha256 text,
  add constraint arquivos_paciente_sha256_valido
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
comment on column public.arquivos_paciente.sha256 is
  'SHA-256 verificado no servidor para novos uploads; NULL preserva arquivos legados.';

-- Only the trusted server may create a proof. Neither this RPC nor the
-- storage.objects catalog provides the binary hash: it must come from the
-- server-side Storage readback. The direct client cannot upload to the bucket.
create function public.prepare_upload_attestation(
  p_actor_id uuid,
  p_paciente_id uuid,
  p_purpose text,
  p_bucket_id text,
  p_storage_path text,
  p_sha256 text,
  p_tamanho_bytes integer,
  p_mime_type text,
  p_token_hash text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_bucket_id is distinct from 'arquivos-paciente'
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_tamanho_bytes is null or p_tamanho_bytes not between 1 and 10485760
    or split_part(p_storage_path, '/', 1) is distinct from p_paciente_id::text
    or p_purpose not in (
      'document:atestado', 'document:declaracao_comparecimento',
      'document:declaracao_acompanhamento', 'file:administrativo', 'file:clinico'
    )
  then raise exception 'Atestacao de upload invalida.' using errcode = '23514'; end if;

  if p_purpose like 'document:%' then
    if p_mime_type is distinct from 'application/pdf'
      or p_storage_path !~ '^[0-9a-f-]{36}/documentos/[0-9a-f-]{36}\.pdf$'
    then raise exception 'Atestacao documental invalida.' using errcode = '23514'; end if;
  elsif p_purpose like 'file:%' then
    if not (
      (p_mime_type = 'application/pdf' and p_storage_path ~ '\.pdf$') or
      (p_mime_type = 'image/jpeg' and p_storage_path ~ '\.jpg$') or
      (p_mime_type = 'image/png' and p_storage_path ~ '\.png$')
    ) or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
    then raise exception 'Atestacao de arquivo invalida.' using errcode = '23514'; end if;
  end if;

  if not exists (select 1 from public.usuarios
                 where id = p_actor_id and status = 'ativo')
    or not exists (select 1 from public.pacientes where id = p_paciente_id)
  then raise exception 'Atestacao sem usuario ou paciente valido.' using errcode = '42501'; end if;

  perform 1 from storage.objects
  where bucket_id = p_bucket_id and name = p_storage_path;
  if not found then raise exception 'Objeto nao encontrado.' using errcode = '23514'; end if;

  -- Bounded opportunistic cleanup, without a scheduled remote job.
  with expired as (
    select token_hash from document_private.upload_attestations
    where expires_at <= clock_timestamp()
    order by expires_at, token_hash
    limit 100 for update skip locked
  )
  delete from document_private.upload_attestations a
  using expired e where a.token_hash = e.token_hash;

  insert into document_private.upload_attestations (
    token_hash, actor_id, paciente_id, purpose, bucket_id, storage_path,
    sha256, tamanho_bytes, mime_type
  ) values (
    p_token_hash, p_actor_id, p_paciente_id, p_purpose, p_bucket_id,
    p_storage_path, p_sha256, p_tamanho_bytes, p_mime_type
  );
end;
$$;
revoke all on function public.prepare_upload_attestation(
  uuid, uuid, text, text, text, text, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_upload_attestation(
  uuid, uuid, text, text, text, text, integer, text, text
) to service_role;

-- Compensation after a failed upload/metadata sequence may discard only the
-- exact short-lived proof. The operation is idempotent and never touches the
-- stored binary or clinical metadata.
create function public.cancel_upload_attestation(p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Token de atestacao invalido.' using errcode = '23514';
  end if;
  delete from document_private.upload_attestations
  where token_hash = p_token_hash;
end;
$$;
revoke all on function public.cancel_upload_attestation(text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_upload_attestation(text) to service_role;

create function document_private.consume_upload_attestation(
  p_upload_token text,
  p_paciente_id uuid,
  p_purpose text,
  p_bucket_id text,
  p_storage_path text,
  p_sha256 text,
  p_tamanho_bytes integer,
  p_mime_type text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_token_hash text;
begin
  if auth.uid() is null or p_upload_token is null
    or p_upload_token !~ '^[0-9a-f]{64}$'
    or p_bucket_id is distinct from 'arquivos-paciente'
    or split_part(p_storage_path, '/', 1) is distinct from p_paciente_id::text
  then raise exception 'Atestacao de upload invalida.' using errcode = '42501'; end if;

  delete from document_private.upload_attestations
  where token_hash = encode(extensions.digest(p_upload_token, 'sha256'), 'hex')
    and actor_id = auth.uid()
    and paciente_id = p_paciente_id
    and purpose = p_purpose
    and bucket_id = p_bucket_id
    and storage_path = p_storage_path
    and sha256 = p_sha256
    and tamanho_bytes = p_tamanho_bytes
    and mime_type = p_mime_type
    and expires_at > clock_timestamp()
  returning token_hash into v_token_hash;
  if v_token_hash is null then
    raise exception 'Atestacao ausente, expirada ou ja utilizada.' using errcode = '23514';
  end if;

  perform 1 from storage.objects
  where bucket_id = p_bucket_id and name = p_storage_path;
  if not found then raise exception 'Objeto nao encontrado.' using errcode = '23514'; end if;
end;
$$;
revoke all on function document_private.consume_upload_attestation(
  text, uuid, text, text, text, text, integer, text
) from public, anon, authenticated, service_role;

create function public.create_official_document_verified(
  p_paciente_id uuid,
  p_atendimento_id uuid,
  p_profissional_autor_id uuid,
  p_tipo public.tipo_documento,
  p_emitido_em date,
  p_finalidade text,
  p_comparecimento_inicio timestamptz,
  p_comparecimento_fim timestamptz,
  p_afastamento_quantidade integer,
  p_afastamento_unidade public.unidade_afastamento,
  p_acompanhante_nome text,
  p_acompanhante_identificacao text,
  p_acompanhante_relacao text,
  p_texto_adicional text,
  p_cid_codigo text,
  p_cid_autorizado boolean,
  p_cid_autorizador_tipo public.tipo_autorizador_cid,
  p_storage_path text,
  p_nome_arquivo text,
  p_tamanho_bytes integer,
  p_layout_version integer,
  p_pdf_sha256 text,
  p_upload_token text
)
returns public.documentos language plpgsql security definer set search_path = '' as $$
begin
  perform document_private.consume_upload_attestation(
    p_upload_token, p_paciente_id, 'document:' || p_tipo::text,
    'arquivos-paciente', p_storage_path, p_pdf_sha256, p_tamanho_bytes,
    'application/pdf'
  );
  return public.create_official_document(
    p_paciente_id, p_atendimento_id, p_profissional_autor_id, p_tipo,
    p_emitido_em, p_finalidade, p_comparecimento_inicio, p_comparecimento_fim,
    p_afastamento_quantidade, p_afastamento_unidade, p_acompanhante_nome,
    p_acompanhante_identificacao, p_acompanhante_relacao, p_texto_adicional,
    p_cid_codigo, p_cid_autorizado, p_cid_autorizador_tipo, p_storage_path,
    p_nome_arquivo, p_tamanho_bytes, p_layout_version, p_pdf_sha256
  );
end;
$$;

create function public.create_patient_file_metadata_verified(
  p_paciente_id uuid,
  p_storage_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes integer,
  p_categoria public.categoria_arquivo_paciente,
  p_sha256 text,
  p_upload_token text
)
returns public.arquivos_paciente
language plpgsql security definer set search_path = '' as $$
declare v_file public.arquivos_paciente%rowtype;
begin
  perform document_private.consume_upload_attestation(
    p_upload_token, p_paciente_id, 'file:' || p_categoria::text,
    'arquivos-paciente', p_storage_path, p_sha256, p_tamanho_bytes, p_mime_type
  );
  v_file := public.create_patient_file_metadata(
    p_paciente_id, p_storage_path, p_nome_original, p_mime_type,
    p_tamanho_bytes, p_categoria
  );
  update public.arquivos_paciente set sha256 = p_sha256
  where id = v_file.id returning * into v_file;
  return v_file;
end;
$$;

revoke all on function public.create_official_document_verified(
  uuid, uuid, uuid, public.tipo_documento, date, text,
  timestamptz, timestamptz, integer, public.unidade_afastamento,
  text, text, text, text, text, boolean, public.tipo_autorizador_cid,
  text, text, integer, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_official_document_verified(
  uuid, uuid, uuid, public.tipo_documento, date, text,
  timestamptz, timestamptz, integer, public.unidade_afastamento,
  text, text, text, text, text, boolean, public.tipo_autorizador_cid,
  text, text, integer, integer, text, text
) to authenticated;
revoke all on function public.create_patient_file_metadata_verified(
  uuid, text, text, text, integer, public.categoria_arquivo_paciente,
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_patient_file_metadata_verified(
  uuid, text, text, text, integer, public.categoria_arquivo_paciente,
  text, text
) to authenticated;

-- The wrappers run as their owner and call these legacy implementations
-- for their established RBAC and audit checks. API roles lose direct entry.
revoke all on function public.create_official_document(
  uuid, uuid, uuid, public.tipo_documento, date, text,
  timestamptz, timestamptz, integer, public.unidade_afastamento,
  text, text, text, text, text, boolean, public.tipo_autorizador_cid,
  text, text, integer, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_patient_file_metadata(
  uuid, text, text, text, integer, public.categoria_arquivo_paciente
) from public, anon, authenticated, service_role;
revoke all on function public.create_document_metadata(
  uuid, uuid, public.tipo_documento, date, date, date,
  text, text, text, integer
) from public, anon, authenticated, service_role;

-- Preserve 0030's actor/type/CID rules while refusing to sign a path under
-- a different patient namespace. Inconsistent historical rows stay intact.
create or replace function public.get_document_download_path(p_documento_id uuid)
returns text language plpgsql security definer set search_path = '' stable as $$
declare
  v_document public.documentos%rowtype;
  v_authorized boolean := false;
begin
  if not public.is_active_user() then return null; end if;
  select * into v_document from public.documentos where id = p_documento_id;
  if not found or split_part(v_document.storage_path, '/', 1)
      is distinct from v_document.paciente_id::text then return null; end if;
  if public.is_active_dentist()
    and v_document.profissional_id = public.current_professional_id() then
    v_authorized := true;
  elsif public.can_manage_operational()
    and v_document.tipo in ('declaracao_comparecimento', 'declaracao_acompanhamento')
    and not exists (select 1 from public.documento_cid where documento_id = v_document.id) then
    v_authorized := true;
  end if;
  if not v_authorized then return null; end if;
  perform 1 from storage.objects
  where bucket_id = 'arquivos-paciente' and name = v_document.storage_path;
  if not found then return null; end if;
  return v_document.storage_path;
end;
$$;
revoke all on function public.get_document_download_path(uuid)
  from public, anon, service_role;
grant execute on function public.get_document_download_path(uuid) to authenticated;

commit;
