-- Sprint 21: conversao controlada de orcamento aprovado em plano de tratamento.
-- Aditiva: migrations 0001-0024 permanecem imutaveis.
begin;

create type public.status_plano_tratamento as enum (
  'planejado', 'em_andamento', 'concluido', 'cancelado'
);

create type public.status_item_plano_tratamento as enum (
  'planejado', 'em_andamento', 'realizado', 'cancelado'
);

create table public.planos_tratamento (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  orcamento_id uuid not null unique references public.orcamentos(id) on delete restrict,
  profissional_id uuid not null references public.profissionais(id) on delete restrict,
  status public.status_plano_tratamento not null default 'planejado',
  cancelado_em timestamptz,
  cancelado_por uuid references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint planos_tratamento_cancelamento_consistente check (
    (status = 'cancelado' and cancelado_em is not null and cancelado_por is not null)
    or (status <> 'cancelado' and cancelado_em is null and cancelado_por is null)
  )
);

create table public.plano_tratamento_itens (
  id uuid primary key default gen_random_uuid(),
  plano_tratamento_id uuid not null references public.planos_tratamento(id) on delete restrict,
  orcamento_item_id uuid not null references public.orcamento_itens(id) on delete restrict,
  descricao_snapshot text not null,
  quantidade_planejada integer not null,
  ordem integer not null,
  status public.status_item_plano_tratamento not null default 'planejado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint plano_tratamento_itens_origem_unica unique (plano_tratamento_id, orcamento_item_id),
  constraint plano_tratamento_itens_ordem_unica unique (plano_tratamento_id, ordem),
  constraint plano_tratamento_itens_descricao_valida check (
    descricao_snapshot = btrim(descricao_snapshot) and char_length(descricao_snapshot) between 2 and 300
  ),
  constraint plano_tratamento_itens_quantidade_valida check (quantidade_planejada between 1 and 999),
  constraint plano_tratamento_itens_ordem_valida check (ordem > 0)
);

alter table public.procedimentos
  add column plano_tratamento_item_id uuid references public.plano_tratamento_itens(id) on delete restrict;

create index planos_tratamento_paciente_idx on public.planos_tratamento(paciente_id, created_at desc, id);
create index planos_tratamento_profissional_idx on public.planos_tratamento(profissional_id, created_at desc, id);
create index plano_tratamento_itens_plano_idx on public.plano_tratamento_itens(plano_tratamento_id, ordem, id);
create index procedimentos_plano_tratamento_item_idx on public.procedimentos(plano_tratamento_item_id) where plano_tratamento_item_id is not null;

create trigger planos_tratamento_set_updated_at
before update on public.planos_tratamento
for each row execute function public.set_updated_at();

create trigger plano_tratamento_itens_set_updated_at
before update on public.plano_tratamento_itens
for each row execute function public.set_updated_at();

alter table public.planos_tratamento enable row level security;
alter table public.plano_tratamento_itens enable row level security;

create policy planos_tratamento_select_administrative_or_own_clinical
on public.planos_tratamento for select to authenticated using (
  public.is_active_user() and (
    public.is_admin()
    or public.is_active_reception()
    or (public.is_active_dentist() and profissional_id = public.current_professional_id())
  )
);

create policy plano_tratamento_itens_select_own_dentist
on public.plano_tratamento_itens for select to authenticated using (
  public.is_active_dentist() and exists (
    select 1 from public.planos_tratamento plano
    where plano.id = plano_tratamento_id
      and plano.profissional_id = public.current_professional_id()
  )
);

revoke insert, update, delete on public.planos_tratamento, public.plano_tratamento_itens from anon, authenticated;
grant select on public.planos_tratamento, public.plano_tratamento_itens to authenticated;
grant all on public.planos_tratamento, public.plano_tratamento_itens to service_role;

-- A situacao clinica e sempre derivada dos procedimentos vinculados. Nenhuma
-- tela ou ator administrativo pode marcar item/plano como realizado manualmente.
create function public.refresh_treatment_plan_state(p_plano_tratamento_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_before public.planos_tratamento%rowtype;
  v_next public.status_plano_tratamento;
  v_total integer;
  v_realizados integer;
begin
  select * into v_before
  from public.planos_tratamento
  where id = p_plano_tratamento_id
  for update;
  if not found then raise exception 'Plano de tratamento nao encontrado.' using errcode = 'P0002'; end if;

  if v_before.status = 'cancelado' then
    update public.plano_tratamento_itens
    set status = 'cancelado', updated_by = coalesce(v_actor, updated_by)
    where plano_tratamento_id = v_before.id and status <> 'cancelado';
    return;
  end if;

  update public.plano_tratamento_itens item
  set status = case
    when coalesce((
      select sum(procedimento.quantidade)
      from public.procedimentos procedimento
      join public.atendimentos atendimento on atendimento.id = procedimento.atendimento_id
      where procedimento.plano_tratamento_item_id = item.id
        and atendimento.status = 'finalizado'
    ), 0) >= item.quantidade_planejada then 'realizado'::public.status_item_plano_tratamento
    when exists (
      select 1 from public.procedimentos procedimento
      where procedimento.plano_tratamento_item_id = item.id
    ) then 'em_andamento'::public.status_item_plano_tratamento
    else 'planejado'::public.status_item_plano_tratamento
  end,
  updated_by = coalesce(v_actor, item.updated_by)
  where item.plano_tratamento_id = v_before.id;

  select count(*), count(*) filter (where status = 'realizado')
    into v_total, v_realizados
  from public.plano_tratamento_itens
  where plano_tratamento_id = v_before.id;
  v_next := case
    when v_total > 0 and v_realizados = v_total then 'concluido'::public.status_plano_tratamento
    when exists (
      select 1 from public.plano_tratamento_itens
      where plano_tratamento_id = v_before.id and status = 'em_andamento'
    ) then 'em_andamento'::public.status_plano_tratamento
    else 'planejado'::public.status_plano_tratamento
  end;

  if v_before.status is distinct from v_next then
    update public.planos_tratamento
    set status = v_next, updated_by = coalesce(v_actor, updated_by)
    where id = v_before.id;
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor,
      case when v_next = 'em_andamento' then 'plano_tratamento_iniciado' else 'plano_tratamento_concluido' end,
      'planos_tratamento', v_before.id,
      jsonb_build_object('orcamento_id', v_before.orcamento_id, 'status_anterior', v_before.status, 'status_atual', v_next)
    );
  end if;
end;
$$;

create function public.convert_budget_to_treatment_plan(p_orcamento_id uuid)
returns public.planos_tratamento
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_orcamento public.orcamentos%rowtype;
  v_plano public.planos_tratamento%rowtype;
  v_total_itens bigint;
  v_item_count integer;
begin
  if not public.is_active_user() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into v_orcamento from public.orcamentos where id = p_orcamento_id for update;
  if not found then raise exception 'Orcamento nao encontrado.' using errcode = 'P0002'; end if;

  if not public.is_admin()
     and (not public.is_active_dentist() or v_profissional is distinct from v_orcamento.profissional_id) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_orcamento.status <> 'aprovado' then
    raise exception 'Somente orcamento aprovado pode ser convertido.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.pacientes where id = v_orcamento.paciente_id and ativo) then
    raise exception 'Paciente inativo ou inexistente.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profissionais profissional
    join public.usuarios usuario on usuario.id = profissional.usuario_id
    where profissional.id = v_orcamento.profissional_id
      and profissional.status = 'ativo' and usuario.status = 'ativo' and usuario.perfil = 'dentista'
  ) then raise exception 'Profissional responsavel invalido.' using errcode = '23514'; end if;

  select count(*), coalesce(sum(item.total_centavos), 0)
    into v_item_count, v_total_itens
  from public.orcamento_itens item
  where item.orcamento_id = v_orcamento.id and item.ativo;
  if v_item_count < 1 or v_total_itens <> v_orcamento.total_centavos then
    raise exception 'Itens do orcamento inconsistentes.' using errcode = '23514';
  end if;

  insert into public.planos_tratamento(
    paciente_id, orcamento_id, profissional_id, created_by, updated_by
  ) values (
    v_orcamento.paciente_id, v_orcamento.id, v_orcamento.profissional_id, v_actor, v_actor
  ) returning * into v_plano;

  insert into public.plano_tratamento_itens(
    plano_tratamento_id, orcamento_item_id, descricao_snapshot, quantidade_planejada, ordem, created_by, updated_by
  )
  select v_plano.id, item.id, item.descricao, item.quantidade,
    row_number() over (order by item.created_at, item.id)::integer, v_actor, v_actor
  from public.orcamento_itens item
  where item.orcamento_id = v_orcamento.id and item.ativo
  order by item.created_at, item.id;

  update public.orcamentos
  set status = 'convertido', updated_by = v_actor
  where id = v_orcamento.id;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values
    (v_actor, 'orcamento_convertido_tratamento', 'orcamentos', v_orcamento.id,
      jsonb_build_object('plano_tratamento_id', v_plano.id, 'paciente_id', v_orcamento.paciente_id, 'profissional_id', v_orcamento.profissional_id)),
    (v_actor, 'plano_tratamento_criado', 'planos_tratamento', v_plano.id,
      jsonb_build_object('orcamento_id', v_orcamento.id, 'paciente_id', v_orcamento.paciente_id, 'profissional_id', v_orcamento.profissional_id, 'quantidade_itens', v_item_count));
  return v_plano;
end;
$$;

create function public.cancel_treatment_plan(p_plano_tratamento_id uuid)
returns public.planos_tratamento
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_plano public.planos_tratamento%rowtype;
begin
  if not public.is_active_user() or not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
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

create function public.link_procedure_to_treatment_plan_item(
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
  if v_plano.status <> 'planejado' or v_plano.paciente_id is distinct from v_atendimento.paciente_id
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

create function public.refresh_treatment_plan_state_after_attendance_finalized()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plano_id uuid;
begin
  if new.status = 'finalizado' and old.status is distinct from new.status then
    for v_plano_id in
      select distinct item.plano_tratamento_id
      from public.procedimentos procedimento
      join public.plano_tratamento_itens item on item.id = procedimento.plano_tratamento_item_id
      where procedimento.atendimento_id = new.id
    loop
      perform public.refresh_treatment_plan_state(v_plano_id);
    end loop;
  end if;
  return new;
end;
$$;

create trigger atendimentos_refresh_treatment_plan_state
after update of status on public.atendimentos
for each row execute function public.refresh_treatment_plan_state_after_attendance_finalized();

-- Mantem a assinatura publica da Sprint 13 e impede que a edicao posterior
-- de quantidade ultrapasse o que foi planejado.
create or replace function public.update_service_procedure(
  p_procedimento_id uuid,
  p_quantidade integer,
  p_valor_aplicado_centavos integer,
  p_detalhes text default null
)
returns public.procedimentos
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_before public.procedimentos%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_result public.procedimentos%rowtype;
  v_changed jsonb := '[]'::jsonb;
  v_item public.plano_tratamento_itens%rowtype;
  v_plano public.planos_tratamento%rowtype;
  v_quantidade_vinculada integer;
begin
  if v_profissional is null then raise exception 'Acesso clinico negado.' using errcode = '42501'; end if;
  if coalesce(p_quantidade, 0) < 1 or p_quantidade > 1000000 or coalesce(p_valor_aplicado_centavos, -1) < 0 or p_valor_aplicado_centavos > 100000000 then
    raise exception 'Dados do servico invalidos.' using errcode = '23514';
  end if;
  if p_detalhes is not null and (p_detalhes <> btrim(p_detalhes) or char_length(p_detalhes) > 2000) then raise exception 'Detalhes invalidos.' using errcode = '23514'; end if;
  select * into v_before from public.procedimentos where id = p_procedimento_id for update;
  if not found or v_before.servico_id is null then raise exception 'Servico realizado nao encontrado.' using errcode = 'P0002'; end if;
  select * into v_atendimento from public.atendimentos where id = v_before.atendimento_id for update;
  if v_atendimento.profissional_id <> v_profissional or v_atendimento.status <> 'em_andamento' then raise exception 'Atendimento nao pode ser alterado.' using errcode = '42501'; end if;
  if exists (
    select 1 from public.procedimento_materiais_consumo consumo
    where consumo.procedimento_id = v_before.id and consumo.quantidade_por_servico > 1000000 / p_quantidade
  ) then raise exception 'Quantidade total de consumo invalida.' using errcode = '23514'; end if;
  if v_before.plano_tratamento_item_id is not null then
    select * into v_item from public.plano_tratamento_itens where id = v_before.plano_tratamento_item_id for update;
    select * into v_plano from public.planos_tratamento where id = v_item.plano_tratamento_id for update;
    if v_plano.status <> 'planejado' or v_plano.profissional_id is distinct from v_profissional then
      raise exception 'Plano de tratamento incompativel.' using errcode = '23514';
    end if;
    select coalesce(sum(procedimento.quantidade), 0)::integer into v_quantidade_vinculada
    from public.procedimentos procedimento
    where procedimento.plano_tratamento_item_id = v_item.id and procedimento.id <> v_before.id;
    if v_quantidade_vinculada + p_quantidade > v_item.quantidade_planejada then
      raise exception 'Quantidade executada excede a planejada.' using errcode = '23514';
    end if;
  end if;
  if v_before.quantidade is distinct from p_quantidade then v_changed := v_changed || jsonb_build_array('quantidade'); end if;
  if v_before.valor_aplicado_centavos is distinct from p_valor_aplicado_centavos then v_changed := v_changed || jsonb_build_array('valor_aplicado_centavos'); end if;
  if v_before.detalhes is distinct from nullif(btrim(p_detalhes), '') then v_changed := v_changed || jsonb_build_array('detalhes'); end if;
  update public.procedimentos set quantidade = p_quantidade, valor_aplicado_centavos = p_valor_aplicado_centavos, detalhes = nullif(btrim(p_detalhes), ''), updated_by = v_actor
  where id = v_before.id returning * into v_result;
  update public.procedimento_materiais_consumo set quantidade_total = quantidade_por_servico * p_quantidade where procedimento_id = v_before.id;
  if jsonb_array_length(v_changed) > 0 then
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (v_actor, 'servico_realizado_atualizado', 'procedimentos', v_result.id, jsonb_build_object('atendimento_id', v_atendimento.id, 'campos_alterados', v_changed));
  end if;
  return v_result;
end;
$$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','usuario_dados_atualizados','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','procedimento_dentes_atualizados','procedimento_vinculado_plano',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','documento_preparado','documento_emitido','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado','orcamento_pdf_emitido','orcamento_convertido_tratamento',
  'plano_tratamento_criado','plano_tratamento_iniciado','plano_tratamento_concluido','plano_tratamento_cancelado',
  'pagamento_criado','pagamento_cancelado','pagamento_estornado','recebivel_criado','parcelamento_criado','parcela_paga','recebivel_cancelado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado',
  'servico_criado','servico_atualizado','servico_ativado','servico_inativado','servico_materiais_alterado','servico_realizado','servico_realizado_atualizado','estoque_consumido_atendimento',
  'controle_lote_ativado','controle_lote_desativado','estoque_lote_entrada','estoque_lote_saida','estoque_lote_ajuste','lote_atualizado','lote_ativado','lote_inativado',
  'equipamento_esterilizacao_criado','equipamento_esterilizacao_atualizado','ciclo_esterilizacao_iniciado','ciclo_esterilizacao_concluido','ciclo_esterilizacao_reprovado','ciclo_esterilizacao_cancelado','pacote_esterilizacao_criado','pacote_esterilizacao_utilizado','pacote_esterilizacao_descartado'
));

revoke all on function public.convert_budget_to_treatment_plan(uuid), public.cancel_treatment_plan(uuid), public.link_procedure_to_treatment_plan_item(uuid, uuid), public.refresh_treatment_plan_state(uuid) from public, anon;
grant execute on function public.convert_budget_to_treatment_plan(uuid), public.cancel_treatment_plan(uuid), public.link_procedure_to_treatment_plan_item(uuid, uuid) to authenticated;

commit;
