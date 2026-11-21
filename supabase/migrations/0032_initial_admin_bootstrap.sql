begin;

-- Authorization for the first administrator is a permanent singleton. API
-- roles cannot read or write it; only a controlled privileged PG connection
-- may insert it after verifying that the installation is empty.
create schema bootstrap_private;
revoke all on schema bootstrap_private from public, anon, authenticated, service_role;

create table bootstrap_private.initial_admin_authorization (
  singleton boolean primary key default true check (singleton),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 200),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  consumed_at timestamptz,
  usuario_id uuid unique references auth.users(id) on delete restrict,
  constraint bootstrap_consumption_consistent check ((consumed_at is null) = (usuario_id is null))
);
alter table bootstrap_private.initial_admin_authorization enable row level security;
revoke all on bootstrap_private.initial_admin_authorization from public, anon, authenticated, service_role;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.convites_provisionamento%rowtype;
  v_bootstrap bootstrap_private.initial_admin_authorization%rowtype;
  v_invite_token text := new.raw_user_meta_data ->> 'provisioning_token';
begin
  if v_invite_token is null and exists (
    select 1 from bootstrap_private.initial_admin_authorization
      where singleton = true and email = lower(btrim(new.email)) and consumed_at is null
  ) then
    -- GoTrue inserts auth.users before it writes app_metadata. Reserve this
    -- pending row only inside its transaction; a deferred trigger below rejects
    -- COMMIT unless the subsequent metadata UPDATE provisions the profile.
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

  -- Existing AAL2-admin invitation path from 0030 remains unchanged.
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

create function bootstrap_private.complete_initial_admin_bootstrap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_bootstrap bootstrap_private.initial_admin_authorization%rowtype;
  v_token text := new.raw_app_meta_data ->> 'initial_admin_bootstrap_token';
begin
  perform pg_catalog.pg_advisory_xact_lock(179384612, 320032);
  select * into v_bootstrap from bootstrap_private.initial_admin_authorization
    where singleton = true for update;
  if v_token is null or v_token !~ '^[0-9a-f]{64}$'
    or not found or v_bootstrap.consumed_at is not null
    or v_bootstrap.expires_at <= clock_timestamp()
    or v_bootstrap.email <> lower(btrim(new.email))
    or v_bootstrap.token_hash <> encode(extensions.digest(v_token, 'sha256'), 'hex')
    or exists (select 1 from auth.users where id <> new.id)
    or exists (select 1 from public.usuarios)
    or exists (select 1 from public.convites_provisionamento)
  then
    raise exception 'INITIAL_ADMIN_BOOTSTRAP_DENIED' using errcode = '42501';
  end if;
  insert into public.usuarios(id, nome, email, perfil, status)
    values(new.id, v_bootstrap.nome, v_bootstrap.email,
      'administrador'::public.perfil_usuario, 'ativo'::public.status_usuario);
  update bootstrap_private.initial_admin_authorization
    set consumed_at = clock_timestamp(), usuario_id = new.id where singleton = true;
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'initial_admin_bootstrap_token'
    where id = new.id;
  return new;
end;
$$;
revoke all on function bootstrap_private.complete_initial_admin_bootstrap()
  from public, anon, authenticated, service_role;
create trigger on_auth_initial_admin_metadata
  after update of raw_app_meta_data on auth.users
  for each row when (new.raw_app_meta_data ? 'initial_admin_bootstrap_token')
  execute function bootstrap_private.complete_initial_admin_bootstrap();

create function bootstrap_private.require_new_auth_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.usuarios where id = new.id) then
    raise exception 'PROVISIONING_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function bootstrap_private.require_new_auth_profile()
  from public, anon, authenticated, service_role;
create constraint trigger auth_new_user_requires_profile
  after insert on auth.users deferrable initially deferred
  for each row execute function bootstrap_private.require_new_auth_profile();

commit;
