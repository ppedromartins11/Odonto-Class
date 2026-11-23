-- A7 LAB ONLY: do not apply to Production before backup, restore, and SQL integration gates.
-- One PostgREST RPC invocation == one PostgreSQL transaction. Reuse existing
-- authorized RPCs rather than bypassing their RLS/role checks.
begin;

create function public.save_budget_atomic(
  p_orcamento_id uuid,
  p_paciente_id uuid,
  p_profissional_id uuid,
  p_validade_em date,
  p_observacao_administrativa text,
  p_itens jsonb,
  p_status public.status_orcamento
) returns uuid
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_budget public.orcamentos%rowtype;
  v_row jsonb;
  v_id uuid;
  v_seen_ids uuid[] := array[]::uuid[];
  v_removed boolean;
  v_desc text;
  v_qty integer;
  v_cents integer;
  v_active_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_status not in ('rascunho'::public.status_orcamento, 'enviado'::public.status_orcamento) then
    raise exception 'Status de orçamento inválido.' using errcode = '23514';
  end if;
  if p_status = 'enviado' and p_validade_em is null then
    raise exception 'Validade obrigatória para envio.' using errcode = '23514';
  end if;
  if coalesce(jsonb_typeof(p_itens), 'null') <> 'array'
     or jsonb_array_length(p_itens) not between 1 and 100 then
    raise exception 'Lista de itens inválida.' using errcode = '23514';
  end if;

  -- Validate the entire request before the first write. Each nested authorized
  -- RPC runs in this SAME database transaction and keeps its existing locks.
  for v_row in select value from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Item de orçamento inválido.' using errcode = '23514';
    end if;

    if v_row ? 'id' and jsonb_typeof(v_row->'id') <> 'string' then
      raise exception 'Identificador de item inválido.' using errcode = '23514';
    end if;
    v_id := (v_row->>'id')::uuid;

    if v_row ? 'removed' and jsonb_typeof(v_row->'removed') <> 'boolean' then
      raise exception 'Marcador de remoção inválido.' using errcode = '23514';
    end if;
    v_removed := coalesce((v_row->>'removed')::boolean, false);

    if v_id is not null then
      if v_id = any(v_seen_ids) then
        raise exception 'Item repetido na solicitação.' using errcode = '23514';
      end if;
      v_seen_ids := array_append(v_seen_ids, v_id);
      -- Reject cross-budget modification, including guessing an item UUID.
      if p_orcamento_id is null or not exists (
        select 1 from public.orcamento_itens
        where id = v_id and orcamento_id = p_orcamento_id and ativo
      ) then
        raise exception 'Item não pertence ao orçamento.' using errcode = '23514';
      end if;
    elsif v_removed then
      -- A newly-added row removed before submit has nothing to persist.
      continue;
    end if;

    if v_removed then
      continue;
    end if;
    v_active_count := v_active_count + 1;
    v_desc := btrim(coalesce(v_row->>'descricao', ''));
    if char_length(v_desc) not between 2 and 300
       or jsonb_typeof(v_row->'quantidade') <> 'number'
       or jsonb_typeof(v_row->'valorUnitarioCentavos') <> 'number'
       or coalesce(v_row->>'quantidade', '') !~ '^[0-9]+$'
       or coalesce(v_row->>'valorUnitarioCentavos', '') !~ '^[0-9]+$' then
      raise exception 'Item possui campos inválidos.' using errcode = '23514';
    end if;
    if (v_row->>'quantidade')::numeric not between 1 and 999
       or (v_row->>'valorUnitarioCentavos')::numeric not between 0 and 100000000 then
      raise exception 'Quantidade ou valor fora do limite.' using errcode = '23514';
    end if;
  end loop;
  if v_active_count = 0 then
    raise exception 'Inclua pelo menos um item ativo.' using errcode = '23514';
  end if;

  if p_orcamento_id is null then
    v_budget := public.create_budget(
      p_paciente_id, p_profissional_id, p_validade_em, p_observacao_administrativa
    );
  else
    v_budget := public.update_budget(
      p_orcamento_id, p_paciente_id, p_profissional_id,
      p_validade_em, p_observacao_administrativa
    );
  end if;

  for v_row in select value from jsonb_array_elements(p_itens) loop
    v_id := (v_row->>'id')::uuid;
    v_removed := coalesce((v_row->>'removed')::boolean, false);
    if v_removed then
      if v_id is not null then
        perform public.remove_budget_item(v_id);
      end if;
      continue;
    end if;

    v_desc := btrim(v_row->>'descricao');
    v_qty := (v_row->>'quantidade')::integer;
    v_cents := (v_row->>'valorUnitarioCentavos')::integer;

    if v_id is null then
      perform public.add_budget_item(v_budget.id, v_desc, v_qty, v_cents);
    else
      perform public.update_budget_item(v_id, v_desc, v_qty, v_cents);
    end if;
  end loop;

  if p_status = 'enviado' then
    perform public.set_budget_status(v_budget.id, 'enviado'::public.status_orcamento);
  end if;

  return v_budget.id;
end;
$function$;

revoke all on function public.save_budget_atomic(
  uuid, uuid, uuid, date, text, jsonb, public.status_orcamento
) from public, anon, authenticated, service_role;
grant execute on function public.save_budget_atomic(
  uuid, uuid, uuid, date, text, jsonb, public.status_orcamento
) to authenticated;

commit;
