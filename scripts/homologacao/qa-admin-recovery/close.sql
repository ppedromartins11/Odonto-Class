-- QA-only closure: restore the original 0032 trigger body, then remove the exceptional authorization path.
-- Preserve the private audit record. Run only against the verified QA project.
begin;
do $$
declare
  v_authorization qa_admin_recovery.authorization%rowtype;
begin
  if current_setting('qa_admin_recovery.project_ref', true) is distinct from 'zxvpyxvhymuibaxgxetf' then
    raise exception 'QA_RECOVERY_PROJECT_GUARD_FAILED';
  end if;
  if (select encode(extensions.digest(
        regexp_replace(trim(p.prosrc), '[[:space:]]+', ' ', 'g'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.handle_new_auth_user()'::regprocedure)
      is distinct from '7c00ce7fdb5a5202433db0c2f74ba9fb9d3a6d0be15d7b551a9943a59fabbd1d' then
    raise exception 'QA_RECOVERY_TRIGGER_DRIFT';
  end if;
  select * into v_authorization from qa_admin_recovery.authorization
    where singleton = true for update;
  if not found then return; end if;
  if v_authorization.consumed_at is null then
    if v_authorization.expires_at > clock_timestamp()
       or exists (select 1 from auth.users where lower(email)=v_authorization.email) then
      raise exception 'QA_RECOVERY_PENDING_RECONCILIATION';
    end if;
  elsif not exists (
    select 1 from auth.users a join public.usuarios u on u.id=a.id
    where a.id=v_authorization.usuario_id and lower(a.email)=v_authorization.email
      and not (coalesce(a.raw_user_meta_data,'{}'::jsonb) ? 'qa_admin_recovery_token')
      and u.perfil='administrador' and u.status='ativo'
  ) or not exists (
    select 1 from qa_admin_recovery.audit
    where event='qa_admin_recovery_consumed' and usuario_id=v_authorization.usuario_id
      and approval_ref=v_authorization.approval_ref
  ) then
    raise exception 'QA_RECOVERY_CONSUMPTION_INCOMPLETE';
  end if;
end $$;
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
do $$
begin
  if (select encode(extensions.digest(
        regexp_replace(trim(p.prosrc), '[[:space:]]+', ' ', 'g'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.handle_new_auth_user()'::regprocedure)
      is distinct from 'd0477e4809f724c05c13a88da9ff2d1542619134e4e9e37c0263cf73be86256f' then
    raise exception 'QA_RECOVERY_RESTORE_HASH_MISMATCH';
  end if;
end $$;
drop table qa_admin_recovery.authorization;
drop function qa_admin_recovery.record_authorization();
commit;
