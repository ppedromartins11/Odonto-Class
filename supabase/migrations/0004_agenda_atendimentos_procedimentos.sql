-- Migration 0004: agenda, atendimentos, evolucao clinica e procedimentos.
-- Bloco integrado - RF-07, RF-08, RF-09, RF-20, RN-02, RN-05 e RNF-01.
-- Aditiva: migrations 0001, 0002 e 0003 permanecem imutaveis.

begin;

create extension if not exists btree_gist with schema extensions;

create type public.status_agendamento as enum (
  'agendado',
  'confirmado',
  'atendido',
  'cancelado',
  'faltou'
);

create type public.status_atendimento as enum (
  'em_andamento',
  'finalizado'
);

-- Helpers pequenos e reutilizaveis para policies/RPCs. O modelo vigente tem
-- um unico perfil por usuario; administrador puro nao herda acesso clinico.
create function public.is_active_reception()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.usuarios as usuario
    where usuario.id = (select auth.uid())
      and usuario.perfil = 'recepcao'::public.perfil_usuario
      and usuario.status = 'ativo'::public.status_usuario
  );
$$;

create function public.current_professional_id()
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select profissional.id
  from public.profissionais as profissional
  join public.usuarios as usuario on usuario.id = profissional.usuario_id
  where usuario.id = (select auth.uid())
    and usuario.perfil = 'dentista'::public.perfil_usuario
    and usuario.status = 'ativo'::public.status_usuario
    and profissional.status = 'ativo'::public.status_usuario
  limit 1;
$$;

revoke execute on function public.is_active_reception() from public, anon;
revoke execute on function public.current_professional_id() from public, anon;
grant execute on function public.is_active_reception() to authenticated;
grant execute on function public.current_professional_id() to authenticated;

create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete restrict,
  profissional_id uuid not null references public.profissionais (id) on delete restrict,
  inicio timestamptz not null,
  fim timestamptz not null,
  status public.status_agendamento not null default 'agendado',
  observacoes_administrativas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios (id) on delete restrict,
  updated_by uuid not null references public.usuarios (id) on delete restrict,
  constraint agendamentos_intervalo_valido check (fim > inicio),
  constraint agendamentos_observacoes_valid check (
    observacoes_administrativas is null
    or (
      observacoes_administrativas = btrim(observacoes_administrativas)
      and char_length(observacoes_administrativas) between 1 and 1000
    )
  ),
  constraint agendamentos_sem_sobreposicao
    exclude using gist (
      profissional_id with =,
      tstzrange(inicio, fim, '[)') with &&
    )
    where (status in ('agendado', 'confirmado', 'atendido'))
);

comment on table public.agendamentos is
  'Evento operacional unico de agenda/consulta. Cancelamento e falta preservam o registro.';
comment on column public.agendamentos.observacoes_administrativas is
  'Somente informacao operacional; nao deve conter evolucao ou dado clinico.';

create table public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid references public.agendamentos (id) on delete restrict,
  paciente_id uuid not null references public.pacientes (id) on delete restrict,
  profissional_id uuid not null references public.profissionais (id) on delete restrict,
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  status public.status_atendimento not null default 'em_andamento',
  evolucao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios (id) on delete restrict,
  updated_by uuid not null references public.usuarios (id) on delete restrict,
  constraint atendimentos_evolucao_valid check (
    evolucao is null
    or (evolucao = btrim(evolucao) and char_length(evolucao) between 1 and 10000)
  ),
  constraint atendimentos_estado_valido check (
    (status = 'em_andamento' and finalizado_em is null)
    or (
      status = 'finalizado'
      and finalizado_em is not null
      and evolucao is not null
    )
  )
);

comment on table public.atendimentos is
  'Registro clinico minimo. agendamento_id nullable conforme PAV-15.';
comment on column public.atendimentos.evolucao is
  'Conteudo clinico sensivel; nunca copiar para auditoria ou payload administrativo.';

create table public.procedimentos (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references public.atendimentos (id) on delete restrict,
  descricao text not null,
  dente text,
  material_utilizado text,
  cor_resina text,
  detalhes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios (id) on delete restrict,
  updated_by uuid not null references public.usuarios (id) on delete restrict,
  constraint procedimentos_descricao_valid check (
    descricao = btrim(descricao) and char_length(descricao) between 2 and 500
  ),
  constraint procedimentos_dente_valid check (
    dente is null or (dente = btrim(dente) and char_length(dente) between 1 and 80)
  ),
  constraint procedimentos_material_valid check (
    material_utilizado is null
    or (
      material_utilizado = btrim(material_utilizado)
      and char_length(material_utilizado) between 1 and 500
    )
  ),
  constraint procedimentos_cor_valid check (
    cor_resina is null
    or (cor_resina = btrim(cor_resina) and char_length(cor_resina) between 1 and 80)
  ),
  constraint procedimentos_detalhes_valid check (
    detalhes is null
    or (detalhes = btrim(detalhes) and char_length(detalhes) between 1 and 2000)
  )
);

comment on table public.procedimentos is
  'Procedimentos em texto simples vinculados ao atendimento; sem catalogo, estoque ou financeiro.';
comment on column public.procedimentos.dente is
  'Dente ou regiao em texto livre. Convencao FDI proposta, sem odontograma e sem obrigatoriedade.';

create unique index atendimentos_agendamento_unique_idx
  on public.atendimentos (agendamento_id)
  where agendamento_id is not null;
create index agendamentos_inicio_idx on public.agendamentos (inicio, id);
create index agendamentos_profissional_inicio_idx
  on public.agendamentos (profissional_id, inicio, id);
create index agendamentos_paciente_inicio_idx
  on public.agendamentos (paciente_id, inicio desc, id);
create index atendimentos_paciente_inicio_idx
  on public.atendimentos (paciente_id, iniciado_em desc, id);
create index atendimentos_profissional_inicio_idx
  on public.atendimentos (profissional_id, iniciado_em desc, id);
create index procedimentos_atendimento_created_idx
  on public.procedimentos (atendimento_id, created_at, id);

create trigger agendamentos_set_updated_at
  before update on public.agendamentos
  for each row execute function public.set_updated_at();
create trigger atendimentos_set_updated_at
  before update on public.atendimentos
  for each row execute function public.set_updated_at();
create trigger procedimentos_set_updated_at
  before update on public.procedimentos
  for each row execute function public.set_updated_at();

alter table public.agendamentos enable row level security;
alter table public.atendimentos enable row level security;
alter table public.procedimentos enable row level security;

create policy agendamentos_select_authorized
  on public.agendamentos for select
  to authenticated
  using (
    (select public.is_active_user())
    and (
      (select public.is_admin())
      or (select public.is_active_reception())
      or profissional_id = (select public.current_professional_id())
    )
  );

create policy atendimentos_select_own_dentist
  on public.atendimentos for select
  to authenticated
  using (
    (select public.is_active_dentist())
    and profissional_id = (select public.current_professional_id())
  );

create policy procedimentos_select_own_dentist
  on public.procedimentos for select
  to authenticated
  using (
    (select public.is_active_dentist())
    and exists (
      select 1
      from public.atendimentos as atendimento
      where atendimento.id = procedimentos.atendimento_id
        and atendimento.profissional_id = (select public.current_professional_id())
    )
  );

revoke insert, update, delete on public.agendamentos from anon, authenticated;
revoke insert, update, delete on public.atendimentos from anon, authenticated;
revoke insert, update, delete on public.procedimentos from anon, authenticated;
grant select on public.agendamentos to authenticated;
grant select on public.atendimentos to authenticated;
grant select on public.procedimentos to authenticated;
grant all on public.agendamentos to service_role;
grant all on public.atendimentos to service_role;
grant all on public.procedimentos to service_role;

-- Mantem o conjunto de eventos fechado sem tocar nas migrations homologadas.
alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (
  evento in (
    'usuario_convidado', 'convite_aceito', 'usuario_ativado',
    'usuario_desativado', 'perfil_alterado', 'acao_administrativa_negada',
    'senha_redefinida', 'configuracao_acesso_alterada', 'paciente_criado',
    'paciente_atualizado', 'paciente_inativado', 'paciente_reativado',
    'alertas_clinicos_atualizados', 'agendamento_criado',
    'agendamento_alterado', 'agendamento_remarcado',
    'agendamento_confirmado', 'agendamento_cancelado',
    'agendamento_falta_registrada', 'agendamento_atendido',
    'atendimento_iniciado', 'atendimento_criado_direto',
    'atendimento_alterado', 'atendimento_finalizado',
    'procedimento_criado', 'procedimento_atualizado'
  )
);

-- Lista pequena de profissionais para filtros/formularios. Expõe somente
-- identificacao profissional operacional, nunca dados clinicos.
create function public.list_active_professionals()
returns table (
  id uuid,
  usuario_id uuid,
  nome text,
  registro_profissional text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_active_user() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  return query
  select profissional.id, profissional.usuario_id, usuario.nome,
         profissional.registro_profissional
  from public.profissionais as profissional
  join public.usuarios as usuario on usuario.id = profissional.usuario_id
  where profissional.status = 'ativo'::public.status_usuario
    and usuario.status = 'ativo'::public.status_usuario
    and usuario.perfil = 'dentista'::public.perfil_usuario
  order by usuario.nome, profissional.id;
end;
$$;

create function public.list_agenda(
  p_data_inicio date,
  p_data_fim date,
  p_profissional_id uuid default null
)
returns table (
  id uuid,
  paciente_id uuid,
  paciente_nome text,
  profissional_id uuid,
  profissional_nome text,
  inicio timestamptz,
  fim timestamptz,
  status public.status_agendamento,
  observacoes_administrativas text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_own_professional uuid := public.current_professional_id();
  v_filter_professional uuid := p_profissional_id;
begin
  if p_data_inicio is null or p_data_fim is null
     or p_data_fim <= p_data_inicio
     or p_data_fim > p_data_inicio + 7 then
    raise exception 'Periodo de agenda invalido.' using errcode = '22023';
  end if;

  if public.is_admin() or public.is_active_reception() then
    null;
  elsif v_own_professional is not null then
    if p_profissional_id is not null and p_profissional_id <> v_own_professional then
      raise exception 'Acesso a agenda negado.' using errcode = '42501';
    end if;
    v_filter_professional := v_own_professional;
  else
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  return query
  select agendamento.id, agendamento.paciente_id, paciente.nome,
         agendamento.profissional_id, usuario.nome, agendamento.inicio,
         agendamento.fim, agendamento.status,
         agendamento.observacoes_administrativas
  from public.agendamentos as agendamento
  join public.pacientes as paciente on paciente.id = agendamento.paciente_id
  join public.profissionais as profissional on profissional.id = agendamento.profissional_id
  join public.usuarios as usuario on usuario.id = profissional.usuario_id
  where agendamento.inicio >= (p_data_inicio::timestamp at time zone 'America/Cuiaba')
    and agendamento.inicio < (p_data_fim::timestamp at time zone 'America/Cuiaba')
    and (v_filter_professional is null or agendamento.profissional_id = v_filter_professional)
  order by agendamento.inicio, paciente.nome, agendamento.id;
end;
$$;

create function public.create_appointment(
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
  v_inicio timestamptz := p_inicio_local at time zone 'America/Cuiaba';
  v_fim timestamptz := p_fim_local at time zone 'America/Cuiaba';
  v_observacoes text := nullif(btrim(p_observacoes_administrativas), '');
  v_appointment public.agendamentos%rowtype;
begin
  if not (public.is_admin() or public.is_active_reception()) then
    raise exception 'Acesso administrativo a agenda negado.' using errcode = '42501';
  end if;
  if p_inicio_local is null or p_fim_local is null or v_fim <= v_inicio or v_fim <= now() then
    raise exception 'Horario invalido.' using errcode = '22023';
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

  insert into public.agendamentos (
    paciente_id, profissional_id, inicio, fim, observacoes_administrativas,
    created_by, updated_by
  ) values (
    p_paciente_id, p_profissional_id, v_inicio, v_fim, v_observacoes,
    v_actor_id, v_actor_id
  ) returning * into v_appointment;

  insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor_id, 'agendamento_criado', 'agendamentos', v_appointment.id,
    jsonb_build_object(
      'paciente_id', v_appointment.paciente_id,
      'profissional_id', v_appointment.profissional_id,
      'inicio', v_appointment.inicio,
      'fim', v_appointment.fim,
      'status', v_appointment.status
    )
  );
  return v_appointment;
end;
$$;

create function public.update_appointment(
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

create function public.set_appointment_status(
  p_agendamento_id uuid,
  p_status public.status_agendamento
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
  v_event text;
begin
  if not (public.is_admin() or public.is_active_reception()) then
    raise exception 'Acesso administrativo a agenda negado.' using errcode = '42501';
  end if;
  select * into v_before from public.agendamentos
  where id = p_agendamento_id for update;
  if not found then
    raise exception 'Agendamento nao encontrado.' using errcode = 'P0002';
  end if;

  if p_status = 'confirmado' and v_before.status = 'agendado' then
    v_event := 'agendamento_confirmado';
  elsif p_status = 'cancelado' and v_before.status in ('agendado', 'confirmado') then
    v_event := 'agendamento_cancelado';
  elsif p_status = 'faltou' and v_before.status in ('agendado', 'confirmado') then
    if now() < v_before.inicio then
      raise exception 'A falta so pode ser registrada a partir do horario marcado.' using errcode = '23514';
    end if;
    v_event := 'agendamento_falta_registrada';
  else
    raise exception 'Transicao de status invalida.' using errcode = '23514';
  end if;

  update public.agendamentos
  set status = p_status, updated_by = v_actor_id
  where id = p_agendamento_id
  returning * into v_after;

  insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor_id, v_event, 'agendamentos', v_after.id,
    jsonb_build_object('status_anterior', v_before.status, 'status_novo', v_after.status)
  );
  return v_after;
end;
$$;

create function public.start_attendance(p_agendamento_id uuid)
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

create function public.create_direct_attendance(p_paciente_id uuid)
returns public.atendimentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_professional_id uuid := public.current_professional_id();
  v_attendance public.atendimentos%rowtype;
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pacientes where id = p_paciente_id and ativo) then
    raise exception 'Paciente invalido ou inativo.' using errcode = '23514';
  end if;

  insert into public.atendimentos (
    paciente_id, profissional_id, created_by, updated_by
  ) values (p_paciente_id, v_professional_id, v_actor_id, v_actor_id)
  returning * into v_attendance;

  insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor_id, 'atendimento_criado_direto', 'atendimentos', v_attendance.id,
    jsonb_build_object('paciente_id', p_paciente_id, 'profissional_id', v_professional_id)
  );
  return v_attendance;
end;
$$;

create function public.update_attendance(
  p_atendimento_id uuid,
  p_evolucao text default null
)
returns public.atendimentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_professional_id uuid := public.current_professional_id();
  v_before public.atendimentos%rowtype;
  v_after public.atendimentos%rowtype;
  v_evolution text := nullif(btrim(p_evolucao), '');
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  select * into v_before from public.atendimentos
  where id = p_atendimento_id for update;
  if not found then
    raise exception 'Atendimento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_before.profissional_id <> v_professional_id then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_before.status <> 'em_andamento' then
    raise exception 'Atendimento finalizado e imutavel.' using errcode = '23514';
  end if;

  update public.atendimentos
  set evolucao = v_evolution, updated_by = v_actor_id
  where id = p_atendimento_id returning * into v_after;

  if v_before.evolucao is distinct from v_after.evolucao then
    insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'atendimento_alterado', 'atendimentos', v_after.id,
      jsonb_build_object('campos_alterados', jsonb_build_array('evolucao'))
    );
  end if;
  return v_after;
end;
$$;

create function public.finalize_attendance(
  p_atendimento_id uuid,
  p_evolucao text
)
returns public.atendimentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_professional_id uuid := public.current_professional_id();
  v_before public.atendimentos%rowtype;
  v_after public.atendimentos%rowtype;
  v_appointment public.agendamentos%rowtype;
  v_evolution text := nullif(btrim(p_evolucao), '');
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_evolution is null then
    raise exception 'Evolucao obrigatoria para finalizar.' using errcode = '23514';
  end if;
  select * into v_before from public.atendimentos
  where id = p_atendimento_id for update;
  if not found then
    raise exception 'Atendimento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_before.profissional_id <> v_professional_id then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_before.status <> 'em_andamento' then
    raise exception 'Atendimento ja finalizado.' using errcode = '23514';
  end if;

  if v_before.agendamento_id is not null then
    select * into v_appointment from public.agendamentos
    where id = v_before.agendamento_id for update;
    if v_appointment.status not in ('agendado', 'confirmado') then
      raise exception 'Status do agendamento impede finalizacao.' using errcode = '23514';
    end if;
  end if;

  update public.atendimentos
  set evolucao = v_evolution,
      status = 'finalizado',
      finalizado_em = now(),
      updated_by = v_actor_id
  where id = p_atendimento_id returning * into v_after;

  if v_before.agendamento_id is not null then
    update public.agendamentos
    set status = 'atendido', updated_by = v_actor_id
    where id = v_before.agendamento_id;
    insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'agendamento_atendido', 'agendamentos', v_before.agendamento_id,
      jsonb_build_object('atendimento_id', v_after.id, 'status_novo', 'atendido')
    );
  end if;

  insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor_id, 'atendimento_finalizado', 'atendimentos', v_after.id,
    jsonb_build_object(
      'agendamento_id', v_after.agendamento_id,
      'paciente_id', v_after.paciente_id,
      'profissional_id', v_after.profissional_id
    )
  );
  return v_after;
end;
$$;

create function public.create_procedure(
  p_atendimento_id uuid,
  p_descricao text,
  p_dente text default null,
  p_material_utilizado text default null,
  p_cor_resina text default null,
  p_detalhes text default null
)
returns public.procedimentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_professional_id uuid := public.current_professional_id();
  v_attendance public.atendimentos%rowtype;
  v_procedure public.procedimentos%rowtype;
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  select * into v_attendance from public.atendimentos
  where id = p_atendimento_id for update;
  if not found then
    raise exception 'Atendimento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_attendance.profissional_id <> v_professional_id then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_attendance.status <> 'em_andamento' then
    raise exception 'Atendimento finalizado e imutavel.' using errcode = '23514';
  end if;

  insert into public.procedimentos (
    atendimento_id, descricao, dente, material_utilizado, cor_resina,
    detalhes, created_by, updated_by
  ) values (
    p_atendimento_id, btrim(coalesce(p_descricao, '')),
    nullif(btrim(p_dente), ''), nullif(btrim(p_material_utilizado), ''),
    nullif(btrim(p_cor_resina), ''), nullif(btrim(p_detalhes), ''),
    v_actor_id, v_actor_id
  ) returning * into v_procedure;

  insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor_id, 'procedimento_criado', 'procedimentos', v_procedure.id,
    jsonb_build_object('atendimento_id', p_atendimento_id)
  );
  return v_procedure;
end;
$$;

create function public.update_procedure(
  p_procedimento_id uuid,
  p_descricao text,
  p_dente text default null,
  p_material_utilizado text default null,
  p_cor_resina text default null,
  p_detalhes text default null
)
returns public.procedimentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_professional_id uuid := public.current_professional_id();
  v_before public.procedimentos%rowtype;
  v_after public.procedimentos%rowtype;
  v_attendance public.atendimentos%rowtype;
  v_changed_fields jsonb := '[]'::jsonb;
  v_description text := btrim(coalesce(p_descricao, ''));
  v_tooth text := nullif(btrim(p_dente), '');
  v_material text := nullif(btrim(p_material_utilizado), '');
  v_color text := nullif(btrim(p_cor_resina), '');
  v_details text := nullif(btrim(p_detalhes), '');
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  select * into v_before from public.procedimentos
  where id = p_procedimento_id for update;
  if not found then
    raise exception 'Procedimento nao encontrado.' using errcode = 'P0002';
  end if;
  select * into v_attendance from public.atendimentos
  where id = v_before.atendimento_id for update;
  if v_attendance.profissional_id <> v_professional_id then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_attendance.status <> 'em_andamento' then
    raise exception 'Atendimento finalizado e imutavel.' using errcode = '23514';
  end if;

  if v_before.descricao is distinct from v_description then v_changed_fields := v_changed_fields || jsonb_build_array('descricao'); end if;
  if v_before.dente is distinct from v_tooth then v_changed_fields := v_changed_fields || jsonb_build_array('dente'); end if;
  if v_before.material_utilizado is distinct from v_material then v_changed_fields := v_changed_fields || jsonb_build_array('material_utilizado'); end if;
  if v_before.cor_resina is distinct from v_color then v_changed_fields := v_changed_fields || jsonb_build_array('cor_resina'); end if;
  if v_before.detalhes is distinct from v_details then v_changed_fields := v_changed_fields || jsonb_build_array('detalhes'); end if;

  update public.procedimentos
  set descricao = v_description, dente = v_tooth,
      material_utilizado = v_material, cor_resina = v_color,
      detalhes = v_details, updated_by = v_actor_id
  where id = p_procedimento_id returning * into v_after;

  if jsonb_array_length(v_changed_fields) > 0 then
    insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'procedimento_atualizado', 'procedimentos', v_after.id,
      jsonb_build_object(
        'atendimento_id', v_after.atendimento_id,
        'campos_alterados', v_changed_fields
      )
    );
  end if;
  return v_after;
end;
$$;

revoke execute on function public.list_active_professionals() from public, anon;
revoke execute on function public.list_agenda(date, date, uuid) from public, anon;
revoke execute on function public.create_appointment(uuid, uuid, timestamp without time zone, timestamp without time zone, text) from public, anon;
revoke execute on function public.update_appointment(uuid, uuid, uuid, timestamp without time zone, timestamp without time zone, text) from public, anon;
revoke execute on function public.set_appointment_status(uuid, public.status_agendamento) from public, anon;
revoke execute on function public.start_attendance(uuid) from public, anon;
revoke execute on function public.create_direct_attendance(uuid) from public, anon;
revoke execute on function public.update_attendance(uuid, text) from public, anon;
revoke execute on function public.finalize_attendance(uuid, text) from public, anon;
revoke execute on function public.create_procedure(uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.update_procedure(uuid, text, text, text, text, text) from public, anon;

grant execute on function public.list_active_professionals() to authenticated;
grant execute on function public.list_agenda(date, date, uuid) to authenticated;
grant execute on function public.create_appointment(uuid, uuid, timestamp without time zone, timestamp without time zone, text) to authenticated;
grant execute on function public.update_appointment(uuid, uuid, uuid, timestamp without time zone, timestamp without time zone, text) to authenticated;
grant execute on function public.set_appointment_status(uuid, public.status_agendamento) to authenticated;
grant execute on function public.start_attendance(uuid) to authenticated;
grant execute on function public.create_direct_attendance(uuid) to authenticated;
grant execute on function public.update_attendance(uuid, text) to authenticated;
grant execute on function public.finalize_attendance(uuid, text) to authenticated;
grant execute on function public.create_procedure(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.update_procedure(uuid, text, text, text, text, text) to authenticated;

alter default privileges in schema public revoke execute on functions from public;

commit;
