-- Sprint 22.7: H06. Nao remedia saldos historicos nem inventa rastreabilidade.
begin;

-- O wrapper publico da 0028 continua exigindo admin AAL2.
create or replace function public.set_stock_lot_control_rbac(
  p_material_id uuid,
  p_controla boolean,
  p_codigo_lote_inicial text default null,
  p_data_validade date default null,
  p_data_fabricacao date default null,
  p_fornecedor text default null
)
returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype; v_code text := nullif(btrim(p_codigo_lote_inicial), '');
begin
  if not public.is_admin() then raise exception 'Acesso ao controle por lote negado.' using errcode = '42501'; end if;
  if p_controla is null then raise exception 'Configuracao de lote invalida.' using errcode = '23514'; end if;
  select * into v_material from public.materiais_estoque where id = p_material_id for update;
  if not found then raise exception 'Material nao encontrado.' using errcode = 'P0002'; end if;
  if v_material.controla_lote_validade = p_controla then
    perform public.assert_lot_stock_balance(v_material.id);
    return v_material;
  end if;
  if p_controla then
    -- O lock de material e compartilhado com consumo/estorno/finalizacao.
    -- Nao travar atendimento aqui: eles o travam antes do material.
    if exists (
      select 1 from public.consumos_clinicos_materiais c
      join public.procedimentos p on p.id = c.procedimento_id
      join public.atendimentos a on a.id = p.atendimento_id
      where c.material_id = v_material.id and c.lote_id is null
        and c.estornado_em is null and a.status = 'em_andamento'
    ) then
      raise exception 'LOT_CONTROL_PENDING_REVERSIBLE_CONSUMPTION' using errcode = '23514';
    end if;
    if v_material.quantidade_atual > 0 and (v_code is null or p_data_validade is null) then
      raise exception 'Informe o lote inicial e sua validade para ativar o controle.' using errcode = '23514';
    end if;
    if p_data_fabricacao is not null and p_data_validade is not null and p_data_fabricacao > p_data_validade then
      raise exception 'Datas do lote inicial invalidas.' using errcode = '23514';
    end if;
    update public.materiais_estoque set controla_lote_validade = true, updated_by = v_actor where id = v_material.id returning * into v_material;
    if v_material.quantidade_atual > 0 then
      insert into public.materiais_lotes(material_id, codigo_lote, quantidade_inicial, quantidade_atual, data_fabricacao, data_validade, fornecedor, created_by, updated_by)
      values(v_material.id, v_code, v_material.quantidade_atual, v_material.quantidade_atual, p_data_fabricacao, p_data_validade, nullif(btrim(p_fornecedor), ''), v_actor, v_actor);
    end if;
  else
    if exists(select 1 from public.materiais_lotes where material_id = v_material.id and quantidade_atual > 0) then
      raise exception 'Zere todos os lotes antes de desativar o controle.' using errcode = '23514';
    end if;
    if v_material.quantidade_atual <> 0 then raise exception 'Saldo agregado divergente.' using errcode = 'P0001'; end if;
    update public.materiais_estoque set controla_lote_validade = false, updated_by = v_actor where id = v_material.id returning * into v_material;
  end if;
  perform public.assert_lot_stock_balance(v_material.id);
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, case when p_controla then 'controle_lote_ativado' else 'controle_lote_desativado' end, 'materiais_estoque', v_material.id, jsonb_build_object('controla_lote_validade', p_controla));
  return v_material;
end;
$$;

create or replace function public.reverse_clinical_material_consumption(
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

  -- Atendimento primeiro; leitura inicial apenas localiza o pai.
  perform 1 from public.atendimentos
  where id = (
    select p.atendimento_id from public.procedimentos p
    join public.consumos_clinicos_materiais c on c.procedimento_id = p.id
    where c.id = p_consumo_id
  ) for update;
  perform p.id from public.procedimentos p
  where p.id = (select procedimento_id from public.consumos_clinicos_materiais where id = p_consumo_id)
  for update;
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

  -- Nao atribuir lote retroativamente nem corrigir divergencia silenciosamente.
  if v_consumo.lote_id is null and v_material.controla_lote_validade then
    raise exception 'LOT_CONTROL_LEGACY_REVERSAL_DENIED' using errcode = '23514';
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

  if v_material.controla_lote_validade then
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


-- R01: serializacao clinica e finalizacao sob locks estaveis.
create or replace function public.record_clinical_material_consumption(
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

  -- Ordem clinica canonica: atendimento antes de procedimento/FKs.
  -- A leitura da FK localiza o pai; o corpo abaixo revalida sob locks.
  perform 1 from public.atendimentos
  where id = (select atendimento_id from public.procedimentos where id = p_procedimento_id)
  for update;
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

create or replace function public.update_procedure(
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
  -- Ordem clinica canonica: atendimento antes de procedimento/FKs.
  -- A leitura da FK localiza o pai; o corpo abaixo revalida sob locks.
  perform 1 from public.atendimentos
  where id = (select atendimento_id from public.procedimentos where id = p_procedimento_id)
  for update;
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

create or replace function public.set_procedure_teeth(
  p_procedimento_id uuid,
  p_dentes smallint[]
)
returns smallint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_procedimento public.procedimentos%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_solicitados smallint[] := coalesce(p_dentes, '{}'::smallint[]);
  v_normalizados smallint[];
  v_anteriores smallint[];
begin
  if not public.is_active_dentist() or v_profissional is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(v_solicitados) as item(dente)
    where item.dente is null
      or not (item.dente = any (array[
        11,12,13,14,15,16,17,18,
        21,22,23,24,25,26,27,28,
        31,32,33,34,35,36,37,38,
        41,42,43,44,45,46,47,48
      ]::smallint[]))
  ) then
    raise exception 'Codigo FDI invalido.' using errcode = '22023';
  end if;

  select coalesce(array_agg(item.dente order by item.dente), '{}'::smallint[])
    into v_normalizados
  from (select distinct dente from unnest(v_solicitados) as source(dente)) item;

  -- Ordem clinica canonica: atendimento antes de procedimento/FKs.
  -- A leitura da FK localiza o pai; o corpo abaixo revalida sob locks.
  perform 1 from public.atendimentos
  where id = (select atendimento_id from public.procedimentos where id = p_procedimento_id)
  for update;
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

  if not found or v_atendimento.profissional_id <> v_profissional then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_atendimento.status <> 'em_andamento' then
    raise exception 'Atendimento finalizado e imutavel.' using errcode = '23514';
  end if;

  select coalesce(array_agg(dente.dente_fdi order by dente.dente_fdi), '{}'::smallint[])
    into v_anteriores
  from public.procedimento_dentes dente
  where dente.procedimento_id = v_procedimento.id;

  if v_anteriores is not distinct from v_normalizados then
    return v_normalizados;
  end if;

  delete from public.procedimento_dentes
  where procedimento_id = v_procedimento.id;

  insert into public.procedimento_dentes(procedimento_id, dente_fdi, created_by)
  select v_procedimento.id, item.dente, v_actor
  from unnest(v_normalizados) as item(dente);

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    'procedimento_dentes_atualizados',
    'procedimentos',
    v_procedimento.id,
    jsonb_build_object(
      'procedimento_id', v_procedimento.id,
      'atendimento_id', v_atendimento.id,
      'quantidade_dentes', cardinality(v_normalizados)
    )
  );

  return v_normalizados;
end;
$$;

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
  -- Ordem clinica canonica: atendimento antes de procedimento/FKs.
  -- A leitura da FK localiza o pai; o corpo abaixo revalida sob locks.
  perform 1 from public.atendimentos
  where id = (select atendimento_id from public.procedimentos where id = p_procedimento_id)
  for update;
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

  -- Ordem clinica canonica: atendimento antes de procedimento/FKs.
  -- A leitura da FK localiza o pai; o corpo abaixo revalida sob locks.
  perform 1 from public.atendimentos
  where id = (select atendimento_id from public.procedimentos where id = p_procedimento_id)
  for update;
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
  if v_before.agendamento_id is not null then
    select * into v_appointment from public.agendamentos where id = v_before.agendamento_id for update;
    if v_appointment.status not in ('agendado', 'confirmado') then
      raise exception 'Status do agendamento impede finalizacao.' using errcode = '23514';
    end if;
  end if;

  perform id from public.procedimentos
  where atendimento_id = v_before.id order by id for update;

  -- Nenhum filtro por controla_lote_validade antes de TODOS os locks.
  -- Atendimento estabiliza procedimentos, previsoes e consumos pelas RPCs.
  -- Inclui consumos reais sem previsao; ordem unica para materiais compartilhados.
  perform material.id
  from public.materiais_estoque material
  where material.id in (
    select previsto.material_id
    from public.procedimento_materiais_consumo previsto
    join public.procedimentos procedimento on procedimento.id = previsto.procedimento_id
    where procedimento.atendimento_id = v_before.id
    union
    select consumo.material_id
    from public.consumos_clinicos_materiais consumo
    join public.procedimentos procedimento on procedimento.id = consumo.procedimento_id
    where procedimento.atendimento_id = v_before.id and consumo.estornado_em is null
  )
  order by material.id
  for update of material;
  -- Nova instrucao/snapshot apos eventual espera: reavalia controle e consumo.
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
          and consumo.lote_id is not null
      )
  ) or exists (
    -- Defesa de estado legado: consumo sem lote nunca comprova rastreabilidade
    -- de material atualmente controlado, mesmo que os saldos coincidam.
    select 1 from public.consumos_clinicos_materiais consumo
    join public.procedimentos procedimento on procedimento.id = consumo.procedimento_id
    join public.materiais_estoque material on material.id = consumo.material_id
    where procedimento.atendimento_id = v_before.id
      and material.controla_lote_validade and consumo.estornado_em is null
      and consumo.lote_id is null
  ) then
    raise exception 'LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING' using errcode = 'P0001';
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

-- F01: ordem explicita das FKs e composicao estavel durante a copia.
create or replace function public.configure_service_material_rbac(
  p_servico_id uuid,
  p_material_id uuid,
  p_quantidade_padrao integer,
  p_ativo boolean default true
)
returns public.servico_materiais
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.servico_materiais%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
  if coalesce(p_quantidade_padrao, 0) < 1 or p_quantidade_padrao > 1000000 then raise exception 'Quantidade invalida.' using errcode = '23514'; end if;
  -- Mesmo pai usado pelo leitor SHARE, antes de FK/material/composicao.
  perform 1 from public.servicos where id = p_servico_id for no key update;
  if not found then raise exception 'Servico nao encontrado.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.materiais_estoque where id = p_material_id and ativo) then raise exception 'Material invalido ou inativo.' using errcode = '23514'; end if;
  insert into public.servico_materiais(servico_id, material_id, quantidade_padrao, ativo, created_by, updated_by)
  values (p_servico_id, p_material_id, p_quantidade_padrao, coalesce(p_ativo, true), v_actor, v_actor)
  on conflict (servico_id, material_id) do update set quantidade_padrao = excluded.quantidade_padrao, ativo = excluded.ativo, updated_by = v_actor
  returning * into v_result;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'servico_materiais_alterado', 'servico_materiais', v_result.id, jsonb_build_object('servico_id', v_result.servico_id, 'material_id', v_result.material_id));
  return v_result;
end;
$$;

create or replace function public.set_service_material_active_rbac(p_servico_material_id uuid, p_ativo boolean)
returns public.servico_materiais
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.servico_materiais%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
  -- servico_id e imutavel nas RPCs; revalidacao da linha segue sob lock do pai.
  perform 1 from public.servicos
  where id = (select servico_id from public.servico_materiais where id = p_servico_material_id)
  for no key update;
  if p_ativo and not exists (select 1 from public.servico_materiais composicao join public.materiais_estoque material on material.id = composicao.material_id where composicao.id = p_servico_material_id and material.ativo) then
    raise exception 'Material invalido ou inativo.' using errcode = '23514';
  end if;
  update public.servico_materiais set ativo = p_ativo, updated_by = v_actor where id = p_servico_material_id returning * into v_result;
  if not found then raise exception 'Composicao de material nao encontrada.' using errcode = 'P0002'; end if;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'servico_materiais_alterado', 'servico_materiais', v_result.id, jsonb_build_object('servico_id', v_result.servico_id, 'material_id', v_result.material_id, 'ativo', v_result.ativo));
  return v_result;
end;
$$;

create or replace function public.create_service_procedure(
  p_atendimento_id uuid,
  p_servico_id uuid,
  p_quantidade integer default 1,
  p_valor_aplicado_centavos integer default null,
  p_detalhes text default null
)
returns public.procedimentos
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_atendimento public.atendimentos%rowtype;
  v_servico public.servicos%rowtype;
  v_result public.procedimentos%rowtype;
  v_valor integer;
  v_composicao public.servico_materiais[];
begin
  if v_profissional is null then raise exception 'Acesso clinico negado.' using errcode = '42501'; end if;
  if coalesce(p_quantidade, 0) < 1 or p_quantidade > 1000000 then raise exception 'Quantidade invalida.' using errcode = '23514'; end if;
  select * into v_atendimento from public.atendimentos where id = p_atendimento_id for update;
  if not found then raise exception 'Atendimento nao encontrado.' using errcode = 'P0002'; end if;
  if v_atendimento.profissional_id <> v_profissional or v_atendimento.status <> 'em_andamento' then raise exception 'Atendimento nao pode ser alterado.' using errcode = '42501'; end if;
  select * into v_servico from public.servicos where id = p_servico_id for share;
  -- SHARE no servico estabiliza inclusive novas linhas (phantoms). Os dois
  -- escritores da composicao tomam NO KEY UPDATE no mesmo pai, antes de DML.
  if not found or not v_servico.ativo then raise exception 'Servico invalido ou inativo.' using errcode = '23514'; end if;
  v_valor := coalesce(p_valor_aplicado_centavos, v_servico.valor_padrao_centavos);
  if v_valor < 0 or v_valor > 100000000 then raise exception 'Valor aplicado invalido.' using errcode = '23514'; end if;
  if p_detalhes is not null and (p_detalhes <> btrim(p_detalhes) or char_length(p_detalhes) > 2000) then raise exception 'Detalhes invalidos.' using errcode = '23514'; end if;
  -- Materializa uma unica vez: validacao, locks e INSERT usam o mesmo conjunto.
  select coalesce(array_agg(composicao order by composicao.material_id),
    array[]::public.servico_materiais[]) into v_composicao
  from public.servico_materiais composicao
  where composicao.servico_id = v_servico.id and composicao.ativo;
  if exists (
    select 1 from unnest(v_composicao) composicao
    where composicao.quantidade_padrao > 1000000 / p_quantidade
  ) then raise exception 'Quantidade total de consumo invalida.' using errcode = '23514'; end if;
  insert into public.procedimentos(atendimento_id, descricao, detalhes, servico_id, quantidade, valor_aplicado_centavos, created_by, updated_by)
  values (v_atendimento.id, v_servico.nome, nullif(btrim(p_detalhes), ''), v_servico.id, p_quantidade, v_valor, v_actor, v_actor)
  returning * into v_result;
  -- Antes de qualquer FK de previsao: menor lock que conflita com FOR UPDATE
  -- da finalizacao, sem serializar criacoes independentes entre si.
  perform material.id from public.materiais_estoque material
  where material.id in (select composicao.material_id from unnest(v_composicao) composicao)
  order by material.id for key share;
  if exists (
    select 1 from unnest(v_composicao) composicao
    join public.materiais_estoque material on material.id = composicao.material_id
    where not material.ativo
  ) then raise exception 'Servico possui material inativo.' using errcode = '23514'; end if;
  insert into public.procedimento_materiais_consumo(procedimento_id, servico_material_id, material_id, quantidade_por_servico, quantidade_total, created_by)
  select v_result.id, composicao.id, composicao.material_id, composicao.quantidade_padrao, composicao.quantidade_padrao * p_quantidade, v_actor
  from unnest(v_composicao) composicao
  order by composicao.material_id;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'servico_realizado', 'procedimentos', v_result.id, jsonb_build_object('atendimento_id', v_atendimento.id, 'servico_id', v_servico.id, 'quantidade', p_quantidade));
  return v_result;
end;
$$;

-- Reafirma o isolamento da implementacao interna.
revoke all on function public.set_stock_lot_control_rbac(uuid,boolean,text,date,date,text) from public, anon, authenticated;
commit;
