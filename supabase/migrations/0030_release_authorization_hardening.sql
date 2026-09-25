-- Sprint 22.7: H01-H05. Migrations 0001-0029 permanecem imutaveis.
begin;

-- H02: preservar paciente/autoria apos inicio, sem bloquear edicao administrativa.
create or replace function public.update_appointment(
  p_agendamento_id uuid,
  p_paciente_id uuid,
  p_profissional_id uuid,
  p_inicio_local timestamp without time zone,
  p_fim_local timestamp without time zone,
  p_observacoes_administrativas text default null
)
returns public.agendamentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before public.agendamentos%rowtype;
  v_after public.agendamentos%rowtype;
  v_inicio timestamptz := p_inicio_local at time zone 'America/Cuiaba';
  v_fim timestamptz := p_fim_local at time zone 'America/Cuiaba';
  v_observacoes text := nullif(btrim(p_observacoes_administrativas), '');
  v_rescheduled boolean;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if not (public.is_admin() or public.is_active_reception()) then
    raise exception 'Acesso administrativo a agenda negado.' using errcode = '42501';
  end if;
  if p_inicio_local is null or p_fim_local is null or v_fim <= v_inicio or v_fim <= now() then
    raise exception 'Horario invalido.' using errcode = '22023';
  end if;

  select * into v_before from public.agendamentos
  where id = p_agendamento_id for update;
  if not found then
    raise exception 'Agendamento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_before.status not in ('agendado', 'confirmado') then
    raise exception 'Agendamento encerrado nao pode ser alterado.' using errcode = '23514';
  end if;
  -- O mesmo lock do start_attendance serializa inicio e reatribuicao.
  if exists (
    select 1 from public.atendimentos a where a.agendamento_id = p_agendamento_id
      and (a.profissional_id is distinct from p_profissional_id
        or a.paciente_id is distinct from p_paciente_id)
  ) then
    raise exception 'ATTENDANCE_ALREADY_STARTED' using errcode = '23514';
  end if;
  if not exists (select 1 from public.pacientes where id = p_paciente_id and ativo) then
    raise exception 'Paciente invalido ou inativo.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profissionais as profissional
    join public.usuarios as usuario on usuario.id = profissional.usuario_id
    where profissional.id = p_profissional_id
      and profissional.status = 'ativo'::public.status_usuario
      and usuario.status = 'ativo'::public.status_usuario
      and usuario.perfil = 'dentista'::public.perfil_usuario
  ) then
    raise exception 'Profissional invalido ou inativo.' using errcode = '23514';
  end if;

  v_rescheduled := v_before.profissional_id is distinct from p_profissional_id
    or v_before.inicio is distinct from v_inicio
    or v_before.fim is distinct from v_fim;
  if v_before.paciente_id is distinct from p_paciente_id then
    v_changed_fields := v_changed_fields || jsonb_build_array('paciente_id');
  end if;
  if v_before.observacoes_administrativas is distinct from v_observacoes then
    v_changed_fields := v_changed_fields || jsonb_build_array('observacoes_administrativas');
  end if;

  update public.agendamentos
  set paciente_id = p_paciente_id,
      profissional_id = p_profissional_id,
      inicio = v_inicio,
      fim = v_fim,
      observacoes_administrativas = v_observacoes,
      status = case when v_rescheduled then 'agendado'::public.status_agendamento else status end,
      updated_by = v_actor_id
  where id = p_agendamento_id
  returning * into v_after;

  if v_rescheduled then
    insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'agendamento_remarcado', 'agendamentos', v_after.id,
      jsonb_build_object(
        'profissional_id_anterior', v_before.profissional_id,
        'profissional_id_novo', v_after.profissional_id,
        'inicio_anterior', v_before.inicio, 'inicio_novo', v_after.inicio,
        'fim_anterior', v_before.fim, 'fim_novo', v_after.fim,
        'status_novo', v_after.status
      )
    );
  elsif jsonb_array_length(v_changed_fields) > 0 then
    insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'agendamento_alterado', 'agendamentos', v_after.id,
      jsonb_build_object('campos_alterados', v_changed_fields)
    );
  end if;
  return v_after;
end;
$$;

create or replace function public.start_attendance(p_agendamento_id uuid)
returns public.atendimentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_professional_id uuid := public.current_professional_id();
  v_appointment public.agendamentos%rowtype;
  v_attendance public.atendimentos%rowtype;
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  select * into v_appointment from public.agendamentos
  where id = p_agendamento_id for update;
  if not found then
    raise exception 'Agendamento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_appointment.profissional_id <> v_professional_id then
    raise exception 'Consulta pertence a outro profissional.' using errcode = '42501';
  end if;
  if v_appointment.status not in ('agendado', 'confirmado') then
    raise exception 'Consulta nao pode iniciar atendimento.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.pacientes where id = v_appointment.paciente_id and ativo) then
    raise exception 'Paciente inativo.' using errcode = '23514';
  end if;

  select * into v_attendance from public.atendimentos
  where agendamento_id = p_agendamento_id;
  if found then
    -- Defesa para vinculos historicos inconsistentes, mesmo que a agenda passe.
    if not public.is_active_dentist()
      or v_attendance.profissional_id is distinct from v_professional_id
      or v_attendance.paciente_id is distinct from v_appointment.paciente_id then
      raise exception 'Acesso ao atendimento negado.' using errcode = '42501';
    end if;
    return v_attendance;
  end if;

  insert into public.atendimentos (
    agendamento_id, paciente_id, profissional_id, created_by, updated_by
  ) values (
    v_appointment.id, v_appointment.paciente_id, v_professional_id,
    v_actor_id, v_actor_id
  ) returning * into v_attendance;

  insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor_id, 'atendimento_iniciado', 'atendimentos', v_attendance.id,
    jsonb_build_object(
      'agendamento_id', v_appointment.id,
      'paciente_id', v_attendance.paciente_id,
      'profissional_id', v_professional_id
    )
  );
  return v_attendance;
end;
$$;

-- H03: nenhuma assinatura legada fica exposta ao cliente ou ao servico.
do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_budget_status'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_function);
  end loop;
end;
$$;

-- H04: gate SQL, preservando as operacoes de estoque compartilhadas.
create or replace function public.register_stock_movement(
  p_material_id uuid, p_tipo public.tipo_movimentacao_estoque, p_quantidade integer,
  p_motivo text default null, p_referencia text default null
)
returns public.movimentacoes_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype;
  v_after integer; v_motivo text := nullif(btrim(p_motivo), ''); v_result public.movimentacoes_estoque%rowtype; v_event text;
begin
  if not public.is_active_user() then raise exception 'Acesso ao estoque negado.' using errcode = '42501'; end if;
  if p_tipo = 'entrada' and not (public.is_admin() or public.is_active_reception()) then raise exception 'Entrada nao autorizada.' using errcode = '42501'; end if;
  if p_tipo = 'saida' and not public.can_operate_stock() then raise exception 'Saida nao autorizada.' using errcode = '42501'; end if;
  if p_tipo = 'ajuste' and not public.is_admin() then raise exception 'Ajuste nao autorizado.' using errcode = '42501'; end if;
  if p_tipo = 'ajuste' then perform public.require_admin_aal2(); end if;
  if p_tipo in ('entrada','saida') and (p_quantidade is null or p_quantidade <= 0 or p_quantidade > 1000000) then raise exception 'Quantidade invalida.' using errcode = '23514'; end if;
  if p_tipo = 'ajuste' and (p_quantidade is null or p_quantidade < 0 or p_quantidade > 1000000 or v_motivo is null) then raise exception 'Ajuste exige nova quantidade valida e motivo.' using errcode = '23514'; end if;
  if p_tipo = 'saida' and public.is_active_dentist() and v_motivo is null then raise exception 'Informe o motivo do consumo.' using errcode = '23514'; end if;
  select * into v_material from public.materiais_estoque where id = p_material_id for update;
  if not found then raise exception 'Material nao encontrado.' using errcode = 'P0002'; end if;
  if v_material.controla_lote_validade then raise exception 'Material controlado por lote exige movimentacao por lote.' using errcode = '23514'; end if;
  if not v_material.ativo then raise exception 'Material inativo nao pode ser movimentado.' using errcode = '23514'; end if;
  v_after := case p_tipo when 'entrada' then v_material.quantidade_atual + p_quantidade when 'saida' then v_material.quantidade_atual - p_quantidade else p_quantidade end;
  if v_after < 0 then raise exception 'Estoque insuficiente para esta saida.' using errcode = '23514'; end if;
  update public.materiais_estoque set quantidade_atual = v_after, updated_by = v_actor where id = v_material.id;
  insert into public.movimentacoes_estoque(material_id,tipo,quantidade,motivo,referencia,quantidade_anterior,quantidade_posterior,created_by)
  values(v_material.id,p_tipo,p_quantidade,v_motivo,nullif(btrim(p_referencia),''),v_material.quantidade_atual,v_after,v_actor) returning * into v_result;
  v_event := case p_tipo when 'entrada' then 'estoque_entrada_registrada' when 'saida' then 'estoque_saida_registrada' else 'estoque_ajuste_registrado' end;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
  values(v_actor,v_event,'movimentacoes_estoque',v_result.id,jsonb_build_object('material_id',v_material.id,'quantidade_anterior',v_material.quantidade_atual,'quantidade_posterior',v_after));
  return v_result;
end;
$$;

create or replace function public.cancel_treatment_plan(p_plano_tratamento_id uuid)
returns public.planos_tratamento
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_plano public.planos_tratamento%rowtype;
begin
  if not public.is_active_user() or not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  perform public.require_admin_aal2();
  select * into v_plano from public.planos_tratamento where id = p_plano_tratamento_id for update;
  if not found then raise exception 'Plano de tratamento nao encontrado.' using errcode = 'P0002'; end if;
  if v_plano.status <> 'planejado' then raise exception 'Plano nao pode ser cancelado.' using errcode = '23514'; end if;
  if exists (
    select 1 from public.procedimentos procedimento
    join public.plano_tratamento_itens item on item.id = procedimento.plano_tratamento_item_id
    where item.plano_tratamento_id = v_plano.id
  ) then raise exception 'Plano com execucao clinica nao pode ser cancelado.' using errcode = '23514'; end if;
  update public.planos_tratamento
  set status = 'cancelado', cancelado_em = now(), cancelado_por = v_actor, updated_by = v_actor
  where id = v_plano.id
  returning * into v_plano;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'plano_tratamento_cancelado', 'planos_tratamento', v_plano.id,
    jsonb_build_object('orcamento_id', v_plano.orcamento_id, 'paciente_id', v_plano.paciente_id));
  perform public.refresh_treatment_plan_state(v_plano.id);
  return v_plano;
end;
$$;

alter policy auditoria_select_admin on public.auditoria
  using ((select public.is_admin()) and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');

-- H01: metadata administrativa nao autoriza acesso ao binario clinico.
-- A funcao inspeciona a tabela clinica sem expor CID ou sua existencia.
create function public.get_document_download_path(p_documento_id uuid)
returns text language plpgsql security definer set search_path = '' stable as $$
declare v_document public.documentos%rowtype;
begin
  if not public.is_active_user() then return null; end if;
  select * into v_document from public.documentos where id = p_documento_id;
  if not found then return null; end if;
  if public.is_active_dentist()
    and v_document.profissional_id = public.current_professional_id() then
    return v_document.storage_path;
  end if;
  -- Atestados e documentos legados sem classificacao factual ficam clinicos.
  if public.can_manage_operational()
    and v_document.tipo in ('declaracao_comparecimento', 'declaracao_acompanhamento')
    and not exists (select 1 from public.documento_cid where documento_id = v_document.id) then
    return v_document.storage_path;
  end if;
  return null;
end;
$$;
revoke all on function public.get_document_download_path(uuid) from public, anon, service_role;
grant execute on function public.get_document_download_path(uuid) to authenticated;

-- H05: a API de convite instalada so transporta user_metadata. O token opaco
-- referencia uma autorizacao criada por admin AAL2; nunca carrega privilegios.
create table public.convites_provisionamento (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) between 3 and 254),
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 200),
  perfil public.perfil_usuario not null,
  created_by uuid not null references public.usuarios(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  usuario_id uuid references auth.users(id) on delete cascade,
  constraint convite_consumo_consistente check ((consumed_at is null) = (usuario_id is null)),
  constraint convite_expiracao_valida check (expires_at > created_at)
);
alter table public.convites_provisionamento enable row level security;
-- Nenhuma policy ou grant permite ao cliente criar/consultar tokens.
revoke all on public.convites_provisionamento from public, anon, authenticated, service_role;
-- Manutencao/cleanup privilegiado pode ler/remover, nunca autorizar convites.
grant select, delete on public.convites_provisionamento to service_role;

create function public.prepare_user_invitation(p_email text, p_nome text, p_perfil public.perfil_usuario)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_nome text := btrim(p_nome);
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  perform public.require_admin_aal2();
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(v_email) > 254 or v_nome is null or length(v_nome) not between 1 and 200
    or p_perfil is null then
    raise exception 'Dados de convite invalidos.' using errcode = '23514';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Convite indisponivel para este email.' using errcode = '23514';
  end if;
  insert into public.convites_provisionamento(email,nome,perfil,created_by,token_hash,expires_at)
  values(v_email,v_nome,p_perfil,auth.uid(),encode(extensions.digest(v_token,'sha256'),'hex'),now() + interval '30 minutes')
  on conflict (email) do update set
    id = gen_random_uuid(), nome = excluded.nome, perfil = excluded.perfil,
    created_by = excluded.created_by, token_hash = excluded.token_hash,
    created_at = now(), expires_at = excluded.expires_at
  where convites_provisionamento.consumed_at is null
  returning id into v_id;
  if v_id is null then raise exception 'Convite indisponivel.' using errcode = '23514'; end if;
  return jsonb_build_object('id',v_id,'token',v_token);
end;
$$;

create function public.revoke_user_invitation(p_convite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  perform public.require_admin_aal2();
  delete from public.convites_provisionamento
  where id = p_convite_id and created_by = auth.uid() and consumed_at is null;
end;
$$;
revoke all on function public.prepare_user_invitation(text,text,public.perfil_usuario), public.revoke_user_invitation(uuid) from public, anon, service_role;
grant execute on function public.prepare_user_invitation(text,text,public.perfil_usuario), public.revoke_user_invitation(uuid) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.convites_provisionamento%rowtype;
  v_token text := new.raw_user_meta_data ->> 'provisioning_token';
begin
  -- O Auth preenche invited_at depois do INSERT. A prova neste ponto e o
  -- token aleatorio de 256 bits entregue somente ao servidor que autorizou
  -- o convite. Email, perfil ou created_by de signup nao constituem prova.
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'PROVISIONING_REQUIRED' using errcode = '42501';
  end if;
  select * into v_invite from public.convites_provisionamento
  where email = lower(btrim(new.email))
    and token_hash = encode(extensions.digest(v_token,'sha256'),'hex')
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
  -- O token ja foi consumido; nao deve permanecer no perfil retornado ao usuario.
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'provisioning_token' where id = new.id;
  return new;
end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated, service_role;
-- on_auth_user_created continua AFTER INSERT, consumindo convite e provisionando
-- perfil, profissional e auditoria atomicamente; UPDATE de metadata nao provisiona.

commit;
