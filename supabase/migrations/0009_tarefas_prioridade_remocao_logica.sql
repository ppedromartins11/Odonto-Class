-- Migration 0009: prioridade e remocao logica de tarefas.
-- Aditiva: migrations anteriores permanecem imutaveis.

begin;

create type public.prioridade_tarefa as enum ('alta', 'media', 'baixa');

alter table public.tarefas
  add column prioridade public.prioridade_tarefa not null default 'media',
  add column removida_em timestamptz,
  add column removida_por uuid references public.usuarios(id) on delete restrict,
  add constraint tarefas_remocao_consistente check (
    (removida_em is null and removida_por is null)
    or (removida_em is not null and removida_por is not null)
  );

create index tarefas_visiveis_idx
  on public.tarefas(status, prioridade, prazo, id)
  where removida_em is null;

drop policy tarefas_select on public.tarefas;
create policy tarefas_select on public.tarefas
for select to authenticated
using (
  public.is_active_user()
  and removida_em is null
  and (
    public.can_manage_operational()
    or responsavel_id = auth.uid()
    or created_by = auth.uid()
  )
);

-- Mantem a assinatura anterior (sem p_prioridade) criada na 0005.
-- Ela continua gravando o default 'media', preservando clientes ainda em transicao.
create function public.create_task(
  p_titulo text,
  p_descricao text,
  p_prazo date,
  p_responsavel_id uuid,
  p_prioridade public.prioridade_tarefa,
  p_paciente_id uuid default null,
  p_agendamento_id uuid default null
)
returns public.tarefas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result public.tarefas%rowtype;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inativo.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.usuarios
    where id = p_responsavel_id and status = 'ativo'
  ) then
    raise exception 'Responsavel invalido.' using errcode = '23514';
  end if;
  if p_paciente_id is not null and not exists (
    select 1 from public.pacientes where id = p_paciente_id and ativo
  ) then
    raise exception 'Paciente invalido.' using errcode = '23514';
  end if;

  insert into public.tarefas (
    titulo,
    descricao,
    prazo,
    responsavel_id,
    prioridade,
    paciente_id,
    agendamento_id,
    created_by,
    updated_by
  ) values (
    btrim(coalesce(p_titulo, '')),
    nullif(btrim(p_descricao), ''),
    p_prazo,
    p_responsavel_id,
    p_prioridade,
    p_paciente_id,
    p_agendamento_id,
    v_actor,
    v_actor
  ) returning * into v_result;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    'tarefa_criada',
    'tarefas',
    v_result.id,
    jsonb_build_object(
      'responsavel_id', v_result.responsavel_id,
      'paciente_id', v_result.paciente_id,
      'prioridade', v_result.prioridade
    )
  );
  return v_result;
end;
$$;

drop function public.update_task(uuid, text, text, date, uuid, uuid, uuid);
create function public.update_task(
  p_tarefa_id uuid,
  p_titulo text,
  p_descricao text,
  p_prazo date,
  p_responsavel_id uuid,
  p_prioridade public.prioridade_tarefa,
  p_paciente_id uuid default null,
  p_agendamento_id uuid default null
)
returns public.tarefas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.tarefas%rowtype;
  v_after public.tarefas%rowtype;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inativo.' using errcode = '42501';
  end if;
  select * into v_before
  from public.tarefas
  where id = p_tarefa_id
  for update;

  if not found or v_before.removida_em is not null then
    raise exception 'Tarefa nao encontrada.' using errcode = 'P0002';
  end if;
  if not public.can_manage_operational() and v_before.created_by <> v_actor then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_before.status <> 'pendente' then
    raise exception 'Tarefa encerrada.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.usuarios
    where id = p_responsavel_id and status = 'ativo'
  ) then
    raise exception 'Responsavel invalido.' using errcode = '23514';
  end if;

  update public.tarefas
  set titulo = btrim(coalesce(p_titulo, '')),
      descricao = nullif(btrim(p_descricao), ''),
      prazo = p_prazo,
      responsavel_id = p_responsavel_id,
      prioridade = p_prioridade,
      paciente_id = p_paciente_id,
      agendamento_id = p_agendamento_id,
      updated_by = v_actor
  where id = v_before.id
  returning * into v_after;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    'tarefa_atualizada',
    'tarefas',
    v_after.id,
    jsonb_build_object(
      'campos_alterados',
      jsonb_build_array(
        'titulo',
        'descricao',
        'prazo',
        'responsavel_id',
        'prioridade',
        'paciente_id',
        'agendamento_id'
      )
    )
  );
  return v_after;
end;
$$;

create or replace function public.set_task_status(
  p_tarefa_id uuid,
  p_status public.status_tarefa
)
returns public.tarefas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.tarefas%rowtype;
  v_after public.tarefas%rowtype;
  v_event text;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inativo.' using errcode = '42501';
  end if;
  select * into v_before
  from public.tarefas
  where id = p_tarefa_id
  for update;

  if not found or v_before.removida_em is not null then
    raise exception 'Tarefa nao encontrada.' using errcode = 'P0002';
  end if;
  if not public.can_manage_operational()
     and v_before.responsavel_id <> v_actor
     and v_before.created_by <> v_actor then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_status not in ('concluida', 'cancelada')
     or v_before.status <> 'pendente' then
    raise exception 'Transicao invalida.' using errcode = '23514';
  end if;

  v_event := case
    when p_status = 'concluida' then 'tarefa_concluida'
    else 'tarefa_cancelada'
  end;

  update public.tarefas
  set status = p_status,
      updated_by = v_actor
  where id = v_before.id
  returning * into v_after;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    v_event,
    'tarefas',
    v_after.id,
    jsonb_build_object(
      'status_anterior', v_before.status,
      'status_novo', v_after.status
    )
  );
  return v_after;
end;
$$;

create function public.soft_delete_task(p_tarefa_id uuid)
returns public.tarefas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.tarefas%rowtype;
  v_after public.tarefas%rowtype;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inativo.' using errcode = '42501';
  end if;
  select * into v_before
  from public.tarefas
  where id = p_tarefa_id
  for update;

  if not found or v_before.removida_em is not null then
    raise exception 'Tarefa nao encontrada.' using errcode = 'P0002';
  end if;
  if not public.can_manage_operational() and v_before.created_by <> v_actor then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.tarefas
  set removida_em = now(),
      removida_por = v_actor,
      updated_by = v_actor
  where id = v_before.id
  returning * into v_after;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    'tarefa_atualizada',
    'tarefas',
    v_after.id,
    jsonb_build_object(
      'campos_alterados', jsonb_build_array('removida_em'),
      'operacao', 'remocao_logica'
    )
  );
  return v_after;
end;
$$;

revoke execute on function public.create_task(
  text, text, date, uuid, public.prioridade_tarefa, uuid, uuid
) from public, anon;
revoke execute on function public.update_task(
  uuid, text, text, date, uuid, public.prioridade_tarefa, uuid, uuid
) from public, anon;
revoke execute on function public.soft_delete_task(uuid) from public, anon;
revoke execute on function public.set_task_status(uuid, public.status_tarefa) from public, anon;

grant execute on function public.create_task(
  text, text, date, uuid, public.prioridade_tarefa, uuid, uuid
) to authenticated;
grant execute on function public.update_task(
  uuid, text, text, date, uuid, public.prioridade_tarefa, uuid, uuid
) to authenticated;
grant execute on function public.soft_delete_task(uuid) to authenticated;
grant execute on function public.set_task_status(uuid, public.status_tarefa) to authenticated;

commit;
