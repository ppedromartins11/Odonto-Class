-- Sprint 22.3: rastreabilidade clinica de lote para procedimento.
-- Aditiva: preserva migrations 0001-0028, pacotes de esterilizacao e FEFO automatico.

begin;

-- Chaves compostas tornam verificavel que a cadeia de consumo aponta para o
-- mesmo procedimento, material, lote e movimentos registrados pela RPC.
alter table public.procedimento_materiais_consumo
  add constraint procedimento_materiais_consumo_id_procedimento_material_unico
  unique (id, procedimento_id, material_id);

alter table public.materiais_lotes
  add constraint materiais_lotes_id_material_unico
  unique (id, material_id);

alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_id_material_procedimento_unico
  unique (id, material_id, procedimento_id);

alter table public.movimentacoes_lotes
  add constraint movimentacoes_lotes_id_movimentacao_lote_unico
  unique (id, movimentacao_id, lote_id);

-- O consumo clinico manual pode existir para um procedimento sem snapshot de
-- servico. Movimentos antigos e automaticos continuam exigindo a origem atual.
alter table public.movimentacoes_estoque
  drop constraint movimentacoes_estoque_origem_atendimento_consistente;

alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_origem_atendimento_consistente check (
    (atendimento_id is null and procedimento_id is null and procedimento_material_consumo_id is null)
    or (atendimento_id is not null and procedimento_id is not null)
  );

-- O indice historico era unico por snapshot porque a baixa automatica criava
-- uma unica movimentacao. Consumo clinico efetivo pode usar mais de um lote
-- para o mesmo snapshot; a exclusao mutua passa a ser dada pelos locks da RPC
-- e pelo lock do atendimento na finalizacao.
drop index public.movimentacoes_estoque_consumo_unico_idx;
create index movimentacoes_estoque_consumo_idx
  on public.movimentacoes_estoque(procedimento_material_consumo_id)
  where procedimento_material_consumo_id is not null;

create table public.consumos_clinicos_materiais (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.procedimentos(id) on delete restrict,
  procedimento_material_consumo_id uuid references public.procedimento_materiais_consumo(id) on delete restrict,
  material_id uuid not null references public.materiais_estoque(id) on delete restrict,
  lote_id uuid references public.materiais_lotes(id) on delete restrict,
  quantidade integer not null,
  movimentacao_estoque_id uuid not null unique references public.movimentacoes_estoque(id) on delete restrict,
  movimentacao_lote_id uuid unique references public.movimentacoes_lotes(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  estornado_em timestamptz,
  estornado_por uuid references public.usuarios(id) on delete restrict,
  movimentacao_estorno_id uuid unique references public.movimentacoes_estoque(id) on delete restrict,
  movimentacao_lote_estorno_id uuid unique references public.movimentacoes_lotes(id) on delete restrict,
  constraint consumos_clinicos_materiais_quantidade_valida check (quantidade between 1 and 1000000),
  constraint consumos_clinicos_materiais_lote_consistente check (
    (lote_id is null and movimentacao_lote_id is null)
    or (lote_id is not null and movimentacao_lote_id is not null)
  ),
  constraint consumos_clinicos_materiais_estorno_consistente check (
    (estornado_em is null and estornado_por is null and movimentacao_estorno_id is null and movimentacao_lote_estorno_id is null)
    or (
      estornado_em is not null and estornado_por is not null and movimentacao_estorno_id is not null
      and ((lote_id is null and movimentacao_lote_estorno_id is null) or (lote_id is not null and movimentacao_lote_estorno_id is not null))
    )
  ),
  constraint consumos_clinicos_materiais_snapshot_consistente foreign key (
    procedimento_material_consumo_id, procedimento_id, material_id
  ) references public.procedimento_materiais_consumo(id, procedimento_id, material_id) on delete restrict,
  constraint consumos_clinicos_materiais_lote_material_consistente foreign key (
    lote_id, material_id
  ) references public.materiais_lotes(id, material_id) on delete restrict,
  constraint consumos_clinicos_materiais_movimento_consistente foreign key (
    movimentacao_estoque_id, material_id, procedimento_id
  ) references public.movimentacoes_estoque(id, material_id, procedimento_id) on delete restrict,
  constraint consumos_clinicos_materiais_movimento_lote_consistente foreign key (
    movimentacao_lote_id, movimentacao_estoque_id, lote_id
  ) references public.movimentacoes_lotes(id, movimentacao_id, lote_id) on delete restrict,
  constraint consumos_clinicos_materiais_estorno_movimento_consistente foreign key (
    movimentacao_estorno_id, material_id, procedimento_id
  ) references public.movimentacoes_estoque(id, material_id, procedimento_id) on delete restrict,
  constraint consumos_clinicos_materiais_estorno_movimento_lote_consistente foreign key (
    movimentacao_lote_estorno_id, movimentacao_estorno_id, lote_id
  ) references public.movimentacoes_lotes(id, movimentacao_id, lote_id) on delete restrict
);

create index consumos_clinicos_materiais_procedimento_idx
  on public.consumos_clinicos_materiais(procedimento_id, created_at, id);
create index consumos_clinicos_materiais_lote_idx
  on public.consumos_clinicos_materiais(lote_id, created_at desc, id)
  where lote_id is not null;
create index consumos_clinicos_materiais_snapshot_ativo_idx
  on public.consumos_clinicos_materiais(procedimento_material_consumo_id, created_at, id)
  where estornado_em is null and procedimento_material_consumo_id is not null;

comment on table public.consumos_clinicos_materiais is
  'Consumo clinico efetivo por procedimento. Snapshot de servico e apenas previsao; cada lote usado gera uma linha e uma movimentacao propria.';

alter table public.consumos_clinicos_materiais enable row level security;

create policy consumos_clinicos_materiais_select_proprio_dentista
  on public.consumos_clinicos_materiais for select to authenticated
  using (
    public.is_active_dentist()
    and exists (
      select 1
      from public.procedimentos procedimento
      join public.atendimentos atendimento on atendimento.id = procedimento.atendimento_id
      where procedimento.id = consumos_clinicos_materiais.procedimento_id
        and atendimento.profissional_id = public.current_professional_id()
    )
  );

revoke insert, update, delete on public.consumos_clinicos_materiais from anon, authenticated;
grant select on public.consumos_clinicos_materiais to authenticated;
grant all on public.consumos_clinicos_materiais to service_role;

create function public.record_clinical_material_consumption(
  p_procedimento_id uuid,
  p_material_id uuid,
  p_lote_id uuid,
  p_quantidade integer,
  p_procedimento_material_consumo_id uuid default null
)
returns public.consumos_clinicos_materiais
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_procedimento public.procedimentos%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_material public.materiais_estoque%rowtype;
  v_lote public.materiais_lotes%rowtype;
  v_movimento public.movimentacoes_estoque%rowtype;
  v_movimento_lote public.movimentacoes_lotes%rowtype;
  v_result public.consumos_clinicos_materiais%rowtype;
  v_saldo_material integer;
  v_saldo_lote integer;
begin
  if v_profissional is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if coalesce(p_quantidade, 0) < 1 or p_quantidade > 1000000 then
    raise exception 'Quantidade invalida.' using errcode = '23514';
  end if;

  select * into v_procedimento
  from public.procedimentos
  where id = p_procedimento_id
  for update;
  if not found then
    raise exception 'Procedimento nao encontrado.' using errcode = 'P0002';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id = v_procedimento.atendimento_id
  for update;
  if not found or v_atendimento.profissional_id <> v_profissional or v_atendimento.status <> 'em_andamento' then
    raise exception 'Atendimento nao permite consumo clinico.' using errcode = '42501';
  end if;

  if p_procedimento_material_consumo_id is not null and not exists (
    select 1
    from public.procedimento_materiais_consumo previsto
    where previsto.id = p_procedimento_material_consumo_id
      and previsto.procedimento_id = v_procedimento.id
      and previsto.material_id = p_material_id
  ) then
    raise exception 'Snapshot de material incompativel.' using errcode = '23514';
  end if;
  if p_procedimento_material_consumo_id is null and exists (
    select 1
    from public.procedimento_materiais_consumo previsto
    where previsto.procedimento_id = v_procedimento.id
      and previsto.material_id = p_material_id
  ) then
    raise exception 'Snapshot previsto obrigatorio para este material.' using errcode = '23514';
  end if;

  select * into v_material
  from public.materiais_estoque
  where id = p_material_id
  for update;
  if not found or not v_material.ativo then
    raise exception 'Material invalido ou inativo.' using errcode = '23514';
  end if;
  if v_material.quantidade_atual < p_quantidade then
    raise exception 'Saldo insuficiente de material.' using errcode = '23514';
  end if;

  if v_material.controla_lote_validade then
    if p_lote_id is null then
      raise exception 'Material controlado exige lote.' using errcode = '23514';
    end if;
    select * into v_lote
    from public.materiais_lotes
    where id = p_lote_id and material_id = v_material.id
    for update;
    if not found or not v_lote.ativo then
      raise exception 'Lote invalido ou inativo.' using errcode = '23514';
    end if;
    if v_lote.data_validade < public.clinic_today() then
      raise exception 'Lote vencido nao pode ser consumido.' using errcode = '23514';
    end if;
    if v_lote.quantidade_atual < p_quantidade then
      raise exception 'Saldo insuficiente no lote.' using errcode = '23514';
    end if;
  elsif p_lote_id is not null then
    raise exception 'Material sem controle de lote nao aceita lote clinico.' using errcode = '23514';
  end if;

  v_saldo_material := v_material.quantidade_atual - p_quantidade;
  update public.materiais_estoque
  set quantidade_atual = v_saldo_material, updated_by = v_actor
  where id = v_material.id;

  insert into public.movimentacoes_estoque(
    material_id, tipo, quantidade, motivo, referencia,
    quantidade_anterior, quantidade_posterior,
    atendimento_id, procedimento_id, procedimento_material_consumo_id, created_by
  ) values (
    v_material.id, 'saida', p_quantidade, null, 'Consumo clinico por procedimento',
    v_material.quantidade_atual, v_saldo_material,
    v_atendimento.id, v_procedimento.id, p_procedimento_material_consumo_id, v_actor
  ) returning * into v_movimento;

  if v_material.controla_lote_validade then
    v_saldo_lote := v_lote.quantidade_atual - p_quantidade;
    update public.materiais_lotes
    set quantidade_atual = v_saldo_lote, updated_by = v_actor
    where id = v_lote.id;
    insert into public.movimentacoes_lotes(
      movimentacao_id, lote_id, quantidade,
      quantidade_lote_anterior, quantidade_lote_posterior,
      finalidade_saida, created_by
    ) values (
      v_movimento.id, v_lote.id, p_quantidade,
      v_lote.quantidade_atual, v_saldo_lote,
      'uso', v_actor
    ) returning * into v_movimento_lote;
  end if;

  insert into public.consumos_clinicos_materiais(
    procedimento_id, procedimento_material_consumo_id, material_id, lote_id,
    quantidade, movimentacao_estoque_id, movimentacao_lote_id, created_by
  ) values (
    v_procedimento.id, p_procedimento_material_consumo_id, v_material.id,
    case when v_material.controla_lote_validade then v_lote.id else null end,
    p_quantidade, v_movimento.id,
    case when v_material.controla_lote_validade then v_movimento_lote.id else null end,
    v_actor
  ) returning * into v_result;

  if v_material.controla_lote_validade then
    perform public.assert_lot_stock_balance(v_material.id);
  end if;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor, 'material_clinico_consumido', 'consumos_clinicos_materiais', v_result.id,
    jsonb_build_object(
      'atendimento_id', v_atendimento.id,
      'procedimento_id', v_procedimento.id,
      'material_id', v_material.id,
      'lote_id', v_result.lote_id,
      'movimentacao_estoque_id', v_movimento.id,
      'quantidade', p_quantidade
    )
  );
  return v_result;
end;
$$;

create function public.reverse_clinical_material_consumption(
  p_consumo_id uuid
)
returns public.consumos_clinicos_materiais
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_consumo public.consumos_clinicos_materiais%rowtype;
  v_procedimento public.procedimentos%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_material public.materiais_estoque%rowtype;
  v_lote public.materiais_lotes%rowtype;
  v_movimento public.movimentacoes_estoque%rowtype;
  v_movimento_lote public.movimentacoes_lotes%rowtype;
  v_saldo_material integer;
  v_saldo_lote integer;
begin
  if v_profissional is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;

  select * into v_consumo
  from public.consumos_clinicos_materiais
  where id = p_consumo_id
  for update;
  if not found then
    raise exception 'Consumo clinico nao encontrado.' using errcode = 'P0002';
  end if;
  if v_consumo.estornado_em is not null then
    raise exception 'Consumo clinico ja estornado.' using errcode = '23514';
  end if;

  select * into v_procedimento
  from public.procedimentos
  where id = v_consumo.procedimento_id
  for update;
  select * into v_atendimento
  from public.atendimentos
  where id = v_procedimento.atendimento_id
  for update;
  if not found or v_atendimento.profissional_id <> v_profissional or v_atendimento.status <> 'em_andamento' then
    raise exception 'Atendimento nao permite estorno clinico.' using errcode = '42501';
  end if;

  select * into v_material
  from public.materiais_estoque
  where id = v_consumo.material_id
  for update;
  if not found or v_material.quantidade_atual + v_consumo.quantidade > 1000000 then
    raise exception 'Estorno gera saldo de material invalido.' using errcode = '23514';
  end if;

  if v_consumo.lote_id is not null then
    select * into v_lote
    from public.materiais_lotes
    where id = v_consumo.lote_id and material_id = v_material.id
    for update;
    if not found or v_lote.quantidade_atual + v_consumo.quantidade > v_lote.quantidade_inicial then
      raise exception 'Estorno gera saldo de lote invalido.' using errcode = '23514';
    end if;
  end if;

  v_saldo_material := v_material.quantidade_atual + v_consumo.quantidade;
  update public.materiais_estoque
  set quantidade_atual = v_saldo_material, updated_by = v_actor
  where id = v_material.id;

  insert into public.movimentacoes_estoque(
    material_id, tipo, quantidade, motivo, referencia,
    quantidade_anterior, quantidade_posterior,
    atendimento_id, procedimento_id, procedimento_material_consumo_id, created_by
  ) values (
    v_material.id, 'entrada', v_consumo.quantidade, null, 'Estorno de consumo clinico',
    v_material.quantidade_atual, v_saldo_material,
    v_atendimento.id, v_procedimento.id, v_consumo.procedimento_material_consumo_id, v_actor
  ) returning * into v_movimento;

  if v_consumo.lote_id is not null then
    v_saldo_lote := v_lote.quantidade_atual + v_consumo.quantidade;
    update public.materiais_lotes
    set quantidade_atual = v_saldo_lote, updated_by = v_actor
    where id = v_lote.id;
    insert into public.movimentacoes_lotes(
      movimentacao_id, lote_id, quantidade,
      quantidade_lote_anterior, quantidade_lote_posterior, created_by
    ) values (
      v_movimento.id, v_lote.id, v_consumo.quantidade,
      v_lote.quantidade_atual, v_saldo_lote, v_actor
    ) returning * into v_movimento_lote;
  end if;

  update public.consumos_clinicos_materiais
  set estornado_em = now(),
      estornado_por = v_actor,
      movimentacao_estorno_id = v_movimento.id,
      movimentacao_lote_estorno_id = case when v_consumo.lote_id is not null then v_movimento_lote.id else null end
  where id = v_consumo.id
  returning * into v_consumo;

  if v_consumo.lote_id is not null then
    perform public.assert_lot_stock_balance(v_material.id);
  end if;

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor, 'material_clinico_estornado', 'consumos_clinicos_materiais', v_consumo.id,
    jsonb_build_object(
      'atendimento_id', v_atendimento.id,
      'procedimento_id', v_procedimento.id,
      'material_id', v_material.id,
      'lote_id', v_consumo.lote_id,
      'movimentacao_estorno_id', v_movimento.id,
      'quantidade', v_consumo.quantidade
    )
  );
  return v_consumo;
end;
$$;

-- Mantem a assinatura publica. Materiais sem lote conservam a baixa
-- automatica, abatendo apenas o residual nao consumido manualmente. Materiais
-- controlados nunca recebem baixa automatica: exigem ao menos um consumo real.
create or replace function public.finalize_attendance(p_atendimento_id uuid, p_evolucao text)
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
  v_material record;
  v_consumption record;
  v_current integer;
  v_after_quantity integer;
  v_movement public.movimentacoes_estoque%rowtype;
  v_clinical_consumption public.consumos_clinicos_materiais%rowtype;
begin
  if v_professional_id is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_evolution is null then
    raise exception 'Evolucao obrigatoria para finalizar.' using errcode = '23514';
  end if;
  select * into v_before from public.atendimentos where id = p_atendimento_id for update;
  if not found then
    raise exception 'Atendimento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_before.profissional_id <> v_professional_id then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_before.status <> 'em_andamento' then
    raise exception 'Atendimento ja finalizado.' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.procedimento_materiais_consumo previsto
    join public.procedimentos procedimento on procedimento.id = previsto.procedimento_id
    join public.materiais_estoque material on material.id = previsto.material_id
    where procedimento.atendimento_id = v_before.id
      and material.controla_lote_validade
      and not exists (
        select 1
        from public.consumos_clinicos_materiais consumo
        where consumo.procedimento_material_consumo_id = previsto.id
          and consumo.estornado_em is null
      )
  ) then
    raise exception 'LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING' using errcode = 'P0001';
  end if;
  if v_before.agendamento_id is not null then
    select * into v_appointment from public.agendamentos where id = v_before.agendamento_id for update;
    if v_appointment.status not in ('agendado', 'confirmado') then
      raise exception 'Status do agendamento impede finalizacao.' using errcode = '23514';
    end if;
  end if;

  -- Preflight com locks por material em ordem deterministica. Apenas o saldo
  -- residual de snapshots sem lote sera baixado automaticamente.
  for v_material in
    select material.id, material.quantidade_atual, material.ativo, consumo.necessario
    from (
      select previsto.material_id,
        sum(greatest(
          previsto.quantidade_total - coalesce((
            select sum(clinico.quantidade)::integer
            from public.consumos_clinicos_materiais clinico
            where clinico.procedimento_material_consumo_id = previsto.id
              and clinico.estornado_em is null
          ), 0),
          0
        ))::integer as necessario
      from public.procedimento_materiais_consumo previsto
      join public.procedimentos procedimento on procedimento.id = previsto.procedimento_id
      join public.materiais_estoque material_lote on material_lote.id = previsto.material_id
      where procedimento.atendimento_id = v_before.id
        and not material_lote.controla_lote_validade
      group by previsto.material_id
    ) consumo
    join public.materiais_estoque material on material.id = consumo.material_id
    order by material.id
    for update of material
  loop
    if not v_material.ativo then
      raise exception 'STOCK_MATERIAL_INACTIVE:%', v_material.id using errcode = 'P0001';
    end if;
    if v_material.quantidade_atual < v_material.necessario then
      raise exception 'STOCK_INSUFFICIENT:%:%:%', v_material.id, v_material.quantidade_atual, v_material.necessario using errcode = 'P0001';
    end if;
  end loop;

  for v_consumption in
    select previsto.id as consumo_previsto_id,
      previsto.material_id,
      previsto.procedimento_id,
      greatest(
        previsto.quantidade_total - coalesce((
          select sum(clinico.quantidade)::integer
          from public.consumos_clinicos_materiais clinico
          where clinico.procedimento_material_consumo_id = previsto.id
            and clinico.estornado_em is null
        ), 0),
        0
      )::integer as quantidade_residual
    from public.procedimento_materiais_consumo previsto
    join public.procedimentos procedimento on procedimento.id = previsto.procedimento_id
    join public.materiais_estoque material on material.id = previsto.material_id
    where procedimento.atendimento_id = v_before.id
      and not material.controla_lote_validade
    order by previsto.material_id, previsto.id
  loop
    if v_consumption.quantidade_residual = 0 then
      continue;
    end if;
    select quantidade_atual into v_current
    from public.materiais_estoque
    where id = v_consumption.material_id
    for update;
    v_after_quantity := v_current - v_consumption.quantidade_residual;
    update public.materiais_estoque
    set quantidade_atual = v_after_quantity, updated_by = v_actor_id
    where id = v_consumption.material_id;
    insert into public.movimentacoes_estoque(
      material_id, tipo, quantidade, motivo, referencia,
      quantidade_anterior, quantidade_posterior,
      atendimento_id, procedimento_id, procedimento_material_consumo_id, created_by
    ) values (
      v_consumption.material_id, 'saida', v_consumption.quantidade_residual, null,
      'Consumo automatico por atendimento', v_current, v_after_quantity,
      v_before.id, v_consumption.procedimento_id, v_consumption.consumo_previsto_id, v_actor_id
    ) returning * into v_movement;
    insert into public.consumos_clinicos_materiais(
      procedimento_id, procedimento_material_consumo_id, material_id,
      quantidade, movimentacao_estoque_id, created_by
    ) values (
      v_consumption.procedimento_id, v_consumption.consumo_previsto_id,
      v_consumption.material_id, v_consumption.quantidade_residual,
      v_movement.id, v_actor_id
    ) returning * into v_clinical_consumption;
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'material_clinico_consumido', 'consumos_clinicos_materiais', v_clinical_consumption.id,
      jsonb_build_object('atendimento_id', v_before.id, 'procedimento_id', v_consumption.procedimento_id, 'material_id', v_consumption.material_id, 'quantidade', v_consumption.quantidade_residual)
    );
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id, 'estoque_consumido_atendimento', 'movimentacoes_estoque', v_consumption.consumo_previsto_id,
      jsonb_build_object('atendimento_id', v_before.id, 'material_id', v_consumption.material_id)
    );
  end loop;

  update public.atendimentos
  set evolucao = v_evolution, status = 'finalizado', finalizado_em = now(), updated_by = v_actor_id
  where id = v_before.id
  returning * into v_after;
  if v_before.agendamento_id is not null then
    update public.agendamentos set status = 'atendido', updated_by = v_actor_id where id = v_before.agendamento_id;
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (v_actor_id, 'agendamento_atendido', 'agendamentos', v_before.agendamento_id, jsonb_build_object('atendimento_id', v_after.id, 'status_novo', 'atendido'));
  end if;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor_id, 'atendimento_finalizado', 'atendimentos', v_after.id, jsonb_build_object('agendamento_id', v_after.agendamento_id, 'paciente_id', v_after.paciente_id, 'profissional_id', v_after.profissional_id));
  return v_after;
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
  'equipamento_esterilizacao_criado','equipamento_esterilizacao_atualizado','ciclo_esterilizacao_iniciado','ciclo_esterilizacao_concluido','ciclo_esterilizacao_reprovado','ciclo_esterilizacao_cancelado','pacote_esterilizacao_criado','pacote_esterilizacao_utilizado','pacote_esterilizacao_descartado',
  'material_clinico_consumido','material_clinico_estornado'
));

revoke all on function public.record_clinical_material_consumption(uuid,uuid,uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.reverse_clinical_material_consumption(uuid) from public, anon, authenticated;
grant execute on function public.record_clinical_material_consumption(uuid,uuid,uuid,integer,uuid) to authenticated;
grant execute on function public.reverse_clinical_material_consumption(uuid) to authenticated;

commit;
