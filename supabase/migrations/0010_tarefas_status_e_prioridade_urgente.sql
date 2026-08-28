-- Migration 0010: amplia o fluxo operacional de tarefas sem reescrever migrations anteriores.
-- Depende da 0009, que introduz prioridade e remoção lógica.

alter type public.prioridade_tarefa add value if not exists 'urgente';
alter type public.status_tarefa add value if not exists 'em_andamento';

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
  if (v_before.status::text = 'pendente' and v_new_status not in ('em_andamento', 'concluida', 'cancelada'))
     or (v_before.status::text = 'em_andamento' and v_new_status not in ('concluida', 'cancelada'))
     or v_before.status::text not in ('pendente', 'em_andamento') then
    raise exception 'Transicao invalida.' using errcode = '23514';
  end if;

  update public.tarefas
  set status = p_status,
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
      'status_novo', v_after.status
    )
  );
  return v_after;
end;
$$;
