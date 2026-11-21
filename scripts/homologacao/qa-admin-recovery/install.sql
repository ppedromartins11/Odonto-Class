-- QA-only incident procedure. Never place this file in supabase/migrations.
-- Run only after the runbook's project, operator and approval gates.
begin;

do $$
begin
  if current_setting('qa_admin_recovery.project_ref', true) is distinct from 'zxvpyxvhymuibaxgxetf' then
    raise exception 'QA_RECOVERY_PROJECT_GUARD_FAILED';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'qa_admin_recovery') then
    raise exception 'QA_RECOVERY_ALREADY_INSTALLED';
  end if;
  if to_regclass('public.convites_provisionamento') is null
     or to_regclass('bootstrap_private.initial_admin_authorization') is null
     or (select count(*) from auth.users) = 0
     or (select count(*) from public.usuarios where perfil = 'administrador' and status = 'ativo') = 0
     or (select encode(extensions.digest(
           regexp_replace(trim(p.prosrc), '[[:space:]]+', ' ', 'g'), 'sha256'), 'hex')
         from pg_proc p where p.oid = 'public.handle_new_auth_user()'::regprocedure)
         <> 'd0477e4809f724c05c13a88da9ff2d1542619134e4e9e37c0263cf73be86256f'
  then
    raise exception 'QA_RECOVERY_SCHEMA_GUARD_FAILED';
  end if;
end $$;

create schema qa_admin_recovery;
revoke all on schema qa_admin_recovery from public, anon, authenticated, service_role;

create table qa_admin_recovery.authorization (
  singleton boolean primary key default true check (singleton),
  email text not null check (email = 'ppedro.dev@hotmail.com'),
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 200),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  approval_ref text not null check (length(approval_ref) between 8 and 128),
  operator_ref text not null check (length(operator_ref) between 3 and 128),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  usuario_id uuid unique references auth.users(id) on delete restrict,
  constraint qa_recovery_short_lived check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint qa_recovery_consumption_consistent check ((consumed_at is null) = (usuario_id is null))
);
alter table qa_admin_recovery.authorization enable row level security;
revoke all on qa_admin_recovery.authorization from public, anon, authenticated, service_role;

create table qa_admin_recovery.audit (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('qa_admin_recovery_authorized', 'qa_admin_recovery_consumed')),
  approval_ref text not null,
  operator_ref text not null,
  target_email text not null,
  usuario_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
alter table qa_admin_recovery.audit enable row level security;
revoke all on qa_admin_recovery.audit from public, anon, authenticated, service_role;

create function qa_admin_recovery.record_authorization()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into qa_admin_recovery.audit(event, approval_ref, operator_ref, target_email)
  values ('qa_admin_recovery_authorized', new.approval_ref, new.operator_ref, new.email);
  return new;
end;
$$;
revoke all on function qa_admin_recovery.record_authorization() from public, anon, authenticated, service_role;
create trigger qa_recovery_authorization_audit
  after insert on qa_admin_recovery.authorization
  for each row execute function qa_admin_recovery.record_authorization();

-- The original 0032 invitation and bootstrap paths are preserved verbatim.
-- This additional path is reachable only with the private, short-lived
-- authorization and its 256-bit bearer token.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.convites_provisionamento%rowtype;
  v_bootstrap bootstrap_private.initial_admin_authorization%rowtype;
  v_recovery qa_admin_recovery.authorization%rowtype;
  v_invite_token text := new.raw_user_meta_data ->> 'provisioning_token';
  v_recovery_token text := new.raw_user_meta_data ->> 'qa_admin_recovery_token';
begin
  if v_recovery_token is not null then
    if v_invite_token is not null or v_recovery_token !~ '^[0-9a-f]{64}$' then
      raise exception 'QA_RECOVERY_DENIED' using errcode = '42501';
    end if;
    select * into v_recovery from qa_admin_recovery.authorization
      where singleton = true for update;
    if not found or v_recovery.consumed_at is not null
      or v_recovery.expires_at <= clock_timestamp()
      or v_recovery.email <> lower(btrim(new.email))
      or v_recovery.token_hash <> encode(extensions.digest(v_recovery_token, 'sha256'), 'hex')
      or exists (select 1 from public.usuarios where email = v_recovery.email)
    then
      raise exception 'QA_RECOVERY_DENIED' using errcode = '42501';
    end if;
    insert into public.usuarios(id, nome, email, perfil, status)
      values(new.id, v_recovery.nome, v_recovery.email,
        'administrador'::public.perfil_usuario, 'ativo'::public.status_usuario);
    update qa_admin_recovery.authorization
      set consumed_at = clock_timestamp(), usuario_id = new.id where singleton = true;
    insert into qa_admin_recovery.audit(event, approval_ref, operator_ref, target_email, usuario_id)
      values('qa_admin_recovery_consumed', v_recovery.approval_ref,
        v_recovery.operator_ref, v_recovery.email, new.id);
    update auth.users
      set raw_user_meta_data = raw_user_meta_data - 'qa_admin_recovery_token' where id = new.id;
    return new;
  end if;

  if v_invite_token is null and exists (
    select 1 from bootstrap_private.initial_admin_authorization
      where singleton = true and email = lower(btrim(new.email)) and consumed_at is null
  ) then
    perform pg_catalog.pg_advisory_xact_lock(179384612, 320032);
    select * into v_bootstrap from bootstrap_private.initial_admin_authorization
      where singleton = true for update;
    if not found or v_bootstrap.consumed_at is not null
      or v_bootstrap.expires_at <= clock_timestamp()
      or v_bootstrap.email <> lower(btrim(new.email))
      or exists (select 1 from auth.users where id <> new.id)
      or exists (select 1 from public.usuarios)
      or exists (select 1 from public.convites_provisionamento)
    then
      raise exception 'INITIAL_ADMIN_BOOTSTRAP_DENIED' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_invite_token is null or v_invite_token !~ '^[0-9a-f]{64}$' then
    raise exception 'PROVISIONING_REQUIRED' using errcode = '42501';
  end if;
  select * into v_invite from public.convites_provisionamento
  where email = lower(btrim(new.email))
    and token_hash = encode(extensions.digest(v_invite_token,'sha256'),'hex')
    and consumed_at is null and expires_at > clock_timestamp()
  for update;
  if not found or v_invite.expires_at <= clock_timestamp() or not exists (
    select 1 from public.usuarios where id = v_invite.created_by
      and perfil = 'administrador' and status = 'ativo'
  ) then
    raise exception 'PROVISIONING_REQUIRED' using errcode = '42501';
  end if;
  insert into public.usuarios(id,nome,email,perfil)
  values(new.id,v_invite.nome,v_invite.email,v_invite.perfil);
  if v_invite.perfil = 'dentista' then
    insert into public.profissionais(usuario_id) values(new.id);
  end if;
  update public.convites_provisionamento set consumed_at = now(), usuario_id = new.id
  where id = v_invite.id;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
  values(v_invite.created_by,'usuario_convidado','usuarios',new.id,jsonb_build_object('perfil',v_invite.perfil));
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'provisioning_token' where id = new.id;
  return new;
end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated, service_role;

commit;
