-- Sprint Kanban de tarefas: status operacional de espera e ordenacao persistente.
-- Aditiva: preserva todas as migrations historicas e as regras existentes de RLS/RBAC.

begin;

alter type public.status_tarefa add value if not exists 'aguardando';

alter table public.tarefas
  add column if not exists ordem_kanban numeric(20,10);

-- Os registros existentes recebem espacamento suficiente para reordenacoes por
-- ponto medio, evitando atualizar todos os cards da coluna a cada movimento.
with ordenadas as (
  select
    id,
    (row_number() over (
      partition by status
      order by prazo asc nulls last, created_at asc, id asc
    ) * 1024)::numeric(20,10) as ordem
  from public.tarefas
  where ordem_kanban is null
)
update public.tarefas tarefa
set ordem_kanban = ordenadas.ordem
from ordenadas
where tarefa.id = ordenadas.id;

alter table public.tarefas
  alter column ordem_kanban set default 0,
  alter column ordem_kanban set not null;

create index if not exists tarefas_kanban_visiveis_idx
  on public.tarefas(status, ordem_kanban, created_at, id)
  where removida_em is null;

-- Mantem a assinatura utilizada pela aplicacao e inclui a primeira posicao da
-- coluna pendente. A assinatura legada sem prioridade segue compativel pelo
-- default da tabela.
create or replace function public.create_task(
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
  v_next_order numeric(20,10);
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

  select coalesce(max(ordem_kanban), 0) + 1024
  into v_next_order
  from public.tarefas
  where status = 'pendente'::public.status_tarefa
    and removida_em is null;

  insert into public.tarefas (
    titulo, descricao, prazo, responsavel_id, prioridade, paciente_id,
    agendamento_id, created_by, updated_by, ordem_kanban
  ) values (
    btrim(coalesce(p_titulo, '')),
    nullif(btrim(p_descricao), ''),
    p_prazo,
    p_responsavel_id,
    p_prioridade,
    p_paciente_id,
    p_agendamento_id,
    v_actor,
    v_actor,
    v_next_order
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

-- A alteracao por menu continua disponivel. Aguardando e uma etapa operacional
-- entre execucao e conclusao; tarefas concluidas/canceladas permanecem terminais.
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
  v_new_status text := p_status::text;
  v_next_order numeric(20,10);
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
  if (v_before.status::text = 'pendente' and v_new_status not in ('em_andamento', 'aguardando', 'concluida', 'cancelada'))
     or (v_before.status::text = 'em_andamento' and v_new_status not in ('aguardando', 'concluida', 'cancelada'))
     or (v_before.status::text = 'aguardando' and v_new_status not in ('em_andamento', 'concluida', 'cancelada'))
     or v_before.status::text not in ('pendente', 'em_andamento', 'aguardando') then
    raise exception 'Transicao invalida.' using errcode = '23514';
  end if;

  select coalesce(max(ordem_kanban), 0) + 1024
  into v_next_order
  from public.tarefas
  where status = p_status
    and removida_em is null
    and id <> v_before.id;

  update public.tarefas
  set status = p_status,
      ordem_kanban = v_next_order,
      updated_by = v_actor
  where id = v_before.id
  returning * into v_after;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    case when v_new_status = 'concluida' then 'tarefa_concluida'
         when v_new_status = 'cancelada' then 'tarefa_cancelada'
         else 'tarefa_atualizada'
    end,
    'tarefas',
    v_after.id,
    jsonb_build_object(
      'status_anterior', v_before.status,
      'status_novo', v_after.status,
      'campos_alterados', jsonb_build_array('status', 'ordem_kanban')
    )
  );
  return v_after;
end;
$$;

-- Recebe apenas os vizinhos da nova posicao. A RPC le e bloqueia as linhas no
-- banco, calcula um ponto medio e nunca aceita conteudo clinico do cliente.
create or replace function public.move_task_kanban(
  p_tarefa_id uuid,
  p_status public.status_tarefa,
  p_before_id uuid default null,
  p_after_id uuid default null
)
returns public.tarefas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.tarefas%rowtype;
  v_after_task public.tarefas%rowtype;
  v_before_task public.tarefas%rowtype;
  v_result public.tarefas%rowtype;
  v_position numeric(20,10);
  v_new_status text := p_status::text;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inativo.' using errcode = '42501';
  end if;
  if p_status::text not in ('pendente', 'em_andamento', 'aguardando', 'concluida') then
    raise exception 'Coluna Kanban invalida.' using errcode = '22023';
  end if;

  select * into v_task
  from public.tarefas
  where id = p_tarefa_id
  for update;

  if not found or v_task.removida_em is not null then
    raise exception 'Tarefa nao encontrada.' using errcode = 'P0002';
  end if;
  if not public.can_manage_operational()
     and v_task.responsavel_id <> v_actor
     and v_task.created_by <> v_actor then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_task.status::text <> v_new_status and (
    (v_task.status::text = 'pendente' and v_new_status not in ('em_andamento', 'aguardando', 'concluida'))
    or (v_task.status::text = 'em_andamento' and v_new_status not in ('aguardando', 'concluida'))
    or (v_task.status::text = 'aguardando' and v_new_status not in ('em_andamento', 'concluida'))
    or v_task.status::text not in ('pendente', 'em_andamento', 'aguardando', 'concluida')
  ) then
    raise exception 'Transicao invalida.' using errcode = '23514';
  end if;
  if p_before_id = p_tarefa_id or p_after_id = p_tarefa_id or p_before_id = p_after_id then
    raise exception 'Posicao Kanban invalida.' using errcode = '22023';
  end if;

  if p_before_id is not null then
    select * into v_before_task
    from public.tarefas
    where id = p_before_id
      and status = p_status
      and removida_em is null
    for update;
    if not found then
      raise exception 'Vizinho anterior invalido.' using errcode = '22023';
    end if;
  end if;
  if p_after_id is not null then
    select * into v_after_task
    from public.tarefas
    where id = p_after_id
      and status = p_status
      and removida_em is null
    for update;
    if not found then
      raise exception 'Vizinho seguinte invalido.' using errcode = '22023';
    end if;
  end if;

  if p_before_id is not null and p_after_id is not null then
    if v_before_task.ordem_kanban >= v_after_task.ordem_kanban then
      raise exception 'Ordem Kanban invalida.' using errcode = '22023';
    end if;
    v_position := (v_before_task.ordem_kanban + v_after_task.ordem_kanban) / 2;
  elsif p_before_id is not null then
    v_position := v_before_task.ordem_kanban + 1024;
  elsif p_after_id is not null then
    v_position := v_after_task.ordem_kanban - 1024;
  else
    v_position := 1024;
  end if;

  update public.tarefas
  set status = p_status,
      ordem_kanban = v_position,
      updated_by = v_actor
  where id = v_task.id
  returning * into v_result;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    case when v_task.status::text <> v_new_status and v_new_status = 'concluida' then 'tarefa_concluida'
         else 'tarefa_atualizada'
    end,
    'tarefas',
    v_result.id,
    jsonb_build_object(
      'campos_alterados', case when v_task.status::text <> v_new_status
        then jsonb_build_array('status', 'ordem_kanban')
        else jsonb_build_array('ordem_kanban')
      end
    )
  );
  return v_result;
end;
$$;

revoke execute on function public.move_task_kanban(uuid, public.status_tarefa, uuid, uuid) from public, anon;
grant execute on function public.move_task_kanban(uuid, public.status_tarefa, uuid, uuid) to authenticated;

commit;
