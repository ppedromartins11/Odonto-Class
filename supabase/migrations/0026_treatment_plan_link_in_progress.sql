-- A plan may have several items/procedures in execution. The original RPC
-- correctly moves it to em_andamento after the first link, so subsequent
-- authorized links must continue to be accepted until it is concluded/cancelled.
create or replace function public.link_procedure_to_treatment_plan_item(
  p_procedimento_id uuid,
  p_plano_tratamento_item_id uuid
)
returns public.procedimentos
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_procedimento public.procedimentos%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_item public.plano_tratamento_itens%rowtype;
  v_plano public.planos_tratamento%rowtype;
  v_quantidade_vinculada integer;
begin
  if not public.is_active_dentist() or v_profissional is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;

  select * into v_procedimento from public.procedimentos where id = p_procedimento_id for update;
  if not found then raise exception 'Procedimento nao encontrado.' using errcode = 'P0002'; end if;
  if v_procedimento.plano_tratamento_item_id is not null then
    raise exception 'Procedimento ja vinculado a um item de plano.' using errcode = '23514';
  end if;

  select * into v_atendimento from public.atendimentos where id = v_procedimento.atendimento_id for update;
  if not found or v_atendimento.profissional_id is distinct from v_profissional or v_atendimento.status <> 'em_andamento' then
    raise exception 'Atendimento nao pode ser alterado.' using errcode = '42501';
  end if;

  select * into v_item from public.plano_tratamento_itens where id = p_plano_tratamento_item_id for update;
  if not found then raise exception 'Item de plano nao encontrado.' using errcode = 'P0002'; end if;
  select * into v_plano from public.planos_tratamento where id = v_item.plano_tratamento_id for update;
  if v_plano.status not in ('planejado', 'em_andamento')
     or v_plano.paciente_id is distinct from v_atendimento.paciente_id
     or v_plano.profissional_id is distinct from v_profissional then
    raise exception 'Item de plano incompativel com o atendimento.' using errcode = '23514';
  end if;

  select coalesce(sum(procedimento.quantidade), 0)::integer into v_quantidade_vinculada
  from public.procedimentos procedimento
  where procedimento.plano_tratamento_item_id = v_item.id;
  if v_quantidade_vinculada + v_procedimento.quantidade > v_item.quantidade_planejada then
    raise exception 'Quantidade executada excede a planejada.' using errcode = '23514';
  end if;

  update public.procedimentos
  set plano_tratamento_item_id = v_item.id, updated_by = v_actor
  where id = v_procedimento.id
  returning * into v_procedimento;
  perform public.refresh_treatment_plan_state(v_plano.id);

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'procedimento_vinculado_plano', 'procedimentos', v_procedimento.id,
    jsonb_build_object('atendimento_id', v_atendimento.id, 'plano_tratamento_id', v_plano.id, 'plano_tratamento_item_id', v_item.id));
  return v_procedimento;
end;
$$;

revoke all on function public.link_procedure_to_treatment_plan_item(uuid, uuid) from public, anon;
grant execute on function public.link_procedure_to_treatment_plan_item(uuid, uuid) to authenticated;
