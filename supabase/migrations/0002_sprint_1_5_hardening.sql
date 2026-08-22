-- Migration 0002: hardening de autenticacao, usuarios, RLS e auditoria.
-- Sprint 1.5 - RF-01, RF-02, RF-20, RN-05 e RNF-01.
-- Esta migration e aditiva: 0001 permanece imutavel.

begin;

-- ============================================================
-- Funcoes auxiliares endurecidas
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create or replace function public.is_active_user()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.usuarios
    where id = (select auth.uid())
      and status = 'ativo'::public.status_usuario
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.usuarios
    where id = (select auth.uid())
      and perfil = 'administrador'::public.perfil_usuario
      and status = 'ativo'::public.status_usuario
  );
$$;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

comment on function public.is_active_user() is
  'Retorna true somente para usuario autenticado com perfil de aplicacao ativo.';

-- ============================================================
-- Privilegios e policies atuais
-- ============================================================

drop policy if exists usuarios_update_admin on public.usuarios;
drop policy if exists profissionais_select_authenticated on public.profissionais;
drop policy if exists profissionais_update_admin on public.profissionais;

create policy profissionais_select_active
  on public.profissionais for select
  to authenticated
  using ((select public.is_active_user()));

revoke insert, update, delete on public.usuarios from anon, authenticated;
revoke insert, update, delete on public.profissionais from anon, authenticated;
grant select on public.usuarios to authenticated;
grant select on public.profissionais to authenticated;
grant all on public.usuarios to service_role;
grant all on public.profissionais to service_role;

-- A migration nao inventa perfil para contas Auth preexistentes. Se houver
-- orfao, interrompe a aplicacao para que a homologacao seja saneada de forma
-- explicita antes de ativar o trigger de provisionamento.
do $$
begin
  if exists (
    select 1
    from auth.users as auth_user
    left join public.usuarios as app_user on app_user.id = auth_user.id
    where app_user.id is null
  ) then
    raise exception
      'Existem contas em auth.users sem perfil em public.usuarios. Saneie antes de aplicar 0002.';
  end if;
end;
$$;

-- Repara, de forma deterministica, a relacao 1:1 dos dentistas existentes.
-- Registros profissionais de quem deixou de ser dentista sao preservados e
-- inativados, conforme a decisao de offboarding aprovada.
insert into public.profissionais (usuario_id, status)
select id, status
from public.usuarios
where perfil = 'dentista'::public.perfil_usuario
on conflict (usuario_id) do update
  set status = excluded.status;

update public.profissionais as profissional
set status = 'inativo'::public.status_usuario
from public.usuarios as usuario
where usuario.id = profissional.usuario_id
  and usuario.perfil <> 'dentista'::public.perfil_usuario;

-- ============================================================
-- Auditoria minima append-only (PAV-18 aprovado na Sprint 1.5)
-- ============================================================

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios (id) on delete set null,
  evento text not null check (
    evento in (
      'usuario_convidado',
      'convite_aceito',
      'usuario_ativado',
      'usuario_desativado',
      'perfil_alterado',
      'acao_administrativa_negada',
      'senha_redefinida',
      'configuracao_acesso_alterada'
    )
  ),
  entidade text not null,
  entidade_id uuid,
  dados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.auditoria is
  'Registro append-only de eventos criticos. Nao armazena senhas, tokens ou conteudo clinico.';

create index auditoria_usuario_created_at_idx
  on public.auditoria (usuario_id, created_at desc);

create index auditoria_entidade_idx
  on public.auditoria (entidade, entidade_id, created_at desc);

alter table public.auditoria enable row level security;

create policy auditoria_select_admin
  on public.auditoria for select
  to authenticated
  using ((select public.is_admin()));

revoke insert, update, delete on public.auditoria from anon, authenticated;
grant select on public.auditoria to authenticated;
grant all on public.auditoria to service_role;

-- ============================================================
-- Alteracao atomica do perfil/status da aplicacao
-- ============================================================

create function public.update_user_access(
  p_usuario_id uuid,
  p_perfil public.perfil_usuario default null,
  p_status public.status_usuario default null
)
returns public.usuarios
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before public.usuarios%rowtype;
  v_after public.usuarios%rowtype;
  v_new_perfil public.perfil_usuario;
  v_new_status public.status_usuario;
  v_other_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Acesso administrativo negado.' using errcode = '42501';
  end if;

  lock table public.usuarios in share row exclusive mode;

  select * into v_before
  from public.usuarios
  where id = p_usuario_id
  for update;

  if not found then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  v_new_perfil := coalesce(p_perfil, v_before.perfil);
  v_new_status := coalesce(p_status, v_before.status);

  if p_usuario_id = v_actor_id
     and (
       v_new_perfil <> 'administrador'::public.perfil_usuario
       or v_new_status <> 'ativo'::public.status_usuario
     ) then
    raise exception 'Nao e permitido remover o proprio acesso administrativo.'
      using errcode = '42501';
  end if;

  if v_before.perfil = 'administrador'::public.perfil_usuario
     and v_before.status = 'ativo'::public.status_usuario
     and (
       v_new_perfil <> 'administrador'::public.perfil_usuario
       or v_new_status <> 'ativo'::public.status_usuario
     ) then
    select count(*) into v_other_admins
    from public.usuarios
    where id <> p_usuario_id
      and perfil = 'administrador'::public.perfil_usuario
      and status = 'ativo'::public.status_usuario;

    if v_other_admins = 0 then
      raise exception 'O sistema precisa manter pelo menos um administrador ativo.'
        using errcode = '23514';
    end if;
  end if;

  update public.usuarios
  set perfil = v_new_perfil,
      status = v_new_status
  where id = p_usuario_id
  returning * into v_after;

  if v_after.perfil = 'dentista'::public.perfil_usuario then
    insert into public.profissionais (usuario_id, status)
    values (v_after.id, v_after.status)
    on conflict (usuario_id) do update
      set status = excluded.status;
  else
    update public.profissionais
    set status = 'inativo'::public.status_usuario
    where usuario_id = v_after.id;
  end if;

  if v_before.perfil <> v_after.perfil then
    insert into public.auditoria (
      usuario_id, evento, entidade, entidade_id, dados
    ) values (
      v_actor_id,
      'perfil_alterado',
      'usuarios',
      v_after.id,
      jsonb_build_object(
        'perfil_anterior', v_before.perfil,
        'perfil_novo', v_after.perfil
      )
    );
  end if;

  if v_before.status <> v_after.status then
    insert into public.auditoria (
      usuario_id, evento, entidade, entidade_id, dados
    ) values (
      v_actor_id,
      case
        when v_after.status = 'ativo'::public.status_usuario
          then 'usuario_ativado'
        else 'usuario_desativado'
      end,
      'usuarios',
      v_after.id,
      jsonb_build_object(
        'status_anterior', v_before.status,
        'status_novo', v_after.status
      )
    );
  end if;

  return v_after;
end;
$$;

revoke execute on function public.update_user_access(
  uuid, public.perfil_usuario, public.status_usuario
) from public, anon;
grant execute on function public.update_user_access(
  uuid, public.perfil_usuario, public.status_usuario
) to authenticated;

-- ============================================================
-- Provisionamento Auth -> usuarios -> profissionais na mesma transacao
-- ============================================================

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := nullif(btrim(new.raw_user_meta_data ->> 'nome'), '');
  v_perfil_text text := new.raw_user_meta_data ->> 'perfil';
  v_perfil public.perfil_usuario;
  v_created_by uuid;
begin
  -- Permite somente o bootstrap manual do primeiro usuario Auth. Depois
  -- que existir um perfil de aplicacao, todo novo usuario exige metadados
  -- administrativos validos e e provisionado atomicamente.
  if v_nome is null or v_perfil_text is null then
    if not exists (select 1 from public.usuarios) then
      return new;
    end if;
    raise exception 'Metadados obrigatorios ausentes no convite.';
  end if;

  if v_perfil_text not in ('administrador', 'dentista', 'recepcao') then
    raise exception 'Perfil de convite invalido.';
  end if;
  v_perfil := v_perfil_text::public.perfil_usuario;

  begin
    v_created_by := (new.raw_user_meta_data ->> 'created_by')::uuid;
  exception when invalid_text_representation then
    raise exception 'Autor do convite invalido.';
  end;

  if v_created_by is null or not exists (
    select 1 from public.usuarios
    where id = v_created_by
      and perfil = 'administrador'::public.perfil_usuario
      and status = 'ativo'::public.status_usuario
  ) then
    raise exception 'Convite sem administrador ativo valido.';
  end if;

  insert into public.usuarios (id, nome, email, perfil)
  values (new.id, v_nome, new.email, v_perfil);

  if v_perfil = 'dentista'::public.perfil_usuario then
    insert into public.profissionais (usuario_id)
    values (new.id);
  end if;

  insert into public.auditoria (
    usuario_id, evento, entidade, entidade_id, dados
  ) values (
    v_created_by,
    'usuario_convidado',
    'usuarios',
    new.id,
    jsonb_build_object('perfil', v_perfil)
  );

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Mantem o e-mail de login e o perfil de aplicacao sincronizados. Uma
-- colisao de e-mail falha fechada e interrompe a alteracao no Auth.
create function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.usuarios
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_auth_user_email()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_auth_user_email();

alter default privileges in schema public
  revoke execute on functions from public;

commit;
