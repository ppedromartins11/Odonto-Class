-- Sprint 15: lotes, validade e esterilizacao.
-- Aditiva: controle_validade permanece legado; migrations 0001-0016 intactas.
begin;

create type public.finalidade_saida_lote as enum ('uso', 'descarte', 'perda');
create type public.status_ciclo_esterilizacao as enum ('em_andamento', 'concluido', 'reprovado', 'cancelado');
create type public.status_pacote_esterilizacao as enum ('pendente', 'ativo', 'utilizado', 'descartado');

alter table public.materiais_estoque
  add column controla_lote_validade boolean not null default false;

create table public.materiais_lotes (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materiais_estoque(id) on delete restrict,
  codigo_lote text not null,
  quantidade_inicial integer not null,
  quantidade_atual integer not null,
  data_fabricacao date,
  data_validade date not null,
  fornecedor text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint materiais_lotes_codigo_valido check (codigo_lote = btrim(codigo_lote) and char_length(codigo_lote) between 1 and 100),
  constraint materiais_lotes_quantidades_validas check (quantidade_inicial > 0 and quantidade_inicial <= 1000000 and quantidade_atual >= 0 and quantidade_atual <= quantidade_inicial),
  constraint materiais_lotes_datas_validas check (data_fabricacao is null or data_fabricacao <= data_validade),
  constraint materiais_lotes_fornecedor_valido check (fornecedor is null or (fornecedor = btrim(fornecedor) and char_length(fornecedor) between 2 and 200)),
  constraint materiais_lotes_codigo_unico unique (material_id, codigo_lote)
);

create table public.movimentacoes_lotes (
  id uuid primary key default gen_random_uuid(),
  movimentacao_id uuid not null references public.movimentacoes_estoque(id) on delete restrict,
  lote_id uuid not null references public.materiais_lotes(id) on delete restrict,
  quantidade integer not null,
  quantidade_lote_anterior integer not null,
  quantidade_lote_posterior integer not null,
  finalidade_saida public.finalidade_saida_lote,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  constraint movimentacoes_lotes_quantidade_valida check (quantidade > 0 and quantidade <= 1000000),
  constraint movimentacoes_lotes_saldos_validos check (quantidade_lote_anterior >= 0 and quantidade_lote_posterior >= 0),
  constraint movimentacoes_lotes_unica unique (movimentacao_id, lote_id)
);

create table public.equipamentos_esterilizacao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  identificacao text not null unique,
  modelo text,
  fabricante text,
  numero_serie text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint equipamentos_esterilizacao_nome_valido check (nome = btrim(nome) and char_length(nome) between 2 and 150),
  constraint equipamentos_esterilizacao_identificacao_valida check (identificacao = btrim(identificacao) and char_length(identificacao) between 2 and 100),
  constraint equipamentos_esterilizacao_modelo_valido check (modelo is null or (modelo = btrim(modelo) and char_length(modelo) between 1 and 120)),
  constraint equipamentos_esterilizacao_fabricante_valido check (fabricante is null or (fabricante = btrim(fabricante) and char_length(fabricante) between 1 and 120)),
  constraint equipamentos_esterilizacao_serie_valida check (numero_serie is null or (numero_serie = btrim(numero_serie) and char_length(numero_serie) between 1 and 120))
);

create sequence public.ciclos_esterilizacao_numero_seq;

create table public.ciclos_esterilizacao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  equipamento_id uuid not null references public.equipamentos_esterilizacao(id) on delete restrict,
  iniciado_em timestamptz not null,
  finalizado_em timestamptz,
  responsavel_id uuid not null references public.usuarios(id) on delete restrict,
  status public.status_ciclo_esterilizacao not null default 'em_andamento',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint ciclos_esterilizacao_codigo_valido check (codigo ~ '^EST-[0-9]{8}-[0-9]{6}$'),
  constraint ciclos_esterilizacao_datas_validas check (finalizado_em is null or finalizado_em >= iniciado_em),
  constraint ciclos_esterilizacao_status_consistente check ((status = 'em_andamento' and finalizado_em is null) or (status <> 'em_andamento' and finalizado_em is not null)),
  constraint ciclos_esterilizacao_observacoes_validas check (observacoes is null or (observacoes = btrim(observacoes) and char_length(observacoes) between 1 and 1000))
);

create table public.pacotes_esterilizacao (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references public.ciclos_esterilizacao(id) on delete restrict,
  codigo text not null unique,
  descricao text not null,
  esterilizado_em date,
  validade_ate date not null,
  status_operacional public.status_pacote_esterilizacao not null default 'pendente',
  utilizado_em timestamptz,
  utilizado_por uuid references public.usuarios(id) on delete restrict,
  descartado_em timestamptz,
  descartado_por uuid references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint pacotes_esterilizacao_codigo_valido check (codigo = btrim(codigo) and char_length(codigo) between 2 and 100),
  constraint pacotes_esterilizacao_descricao_valida check (descricao = btrim(descricao) and char_length(descricao) between 2 and 300),
  constraint pacotes_esterilizacao_datas_validas check (esterilizado_em is null or validade_ate >= esterilizado_em),
  constraint pacotes_esterilizacao_uso_consistente check ((status_operacional = 'utilizado' and utilizado_em is not null and utilizado_por is not null and descartado_em is null and descartado_por is null) or (status_operacional <> 'utilizado' and utilizado_em is null and utilizado_por is null)),
  constraint pacotes_esterilizacao_descarte_consistente check ((status_operacional = 'descartado' and descartado_em is not null and descartado_por is not null and utilizado_em is null and utilizado_por is null) or (status_operacional <> 'descartado' and descartado_em is null and descartado_por is null)),
  constraint pacotes_esterilizacao_ativo_consistente check ((status_operacional in ('pendente','descartado') or esterilizado_em is not null))
);

create index materiais_lotes_listagem_idx on public.materiais_lotes(ativo, data_validade, material_id, id);
create index materiais_lotes_material_saldo_idx on public.materiais_lotes(material_id, data_validade, id) where quantidade_atual > 0;
create index movimentacoes_lotes_movimento_idx on public.movimentacoes_lotes(movimentacao_id, id);
create index movimentacoes_lotes_lote_idx on public.movimentacoes_lotes(lote_id, created_at desc, id);
create index equipamentos_esterilizacao_listagem_idx on public.equipamentos_esterilizacao(ativo, nome, id);
create index ciclos_esterilizacao_listagem_idx on public.ciclos_esterilizacao(status, iniciado_em desc, id);
create index ciclos_esterilizacao_equipamento_idx on public.ciclos_esterilizacao(equipamento_id, iniciado_em desc, id);
create index pacotes_esterilizacao_listagem_idx on public.pacotes_esterilizacao(status_operacional, validade_ate, id);
create index pacotes_esterilizacao_ciclo_idx on public.pacotes_esterilizacao(ciclo_id, id);

create trigger materiais_lotes_set_updated_at before update on public.materiais_lotes for each row execute function public.set_updated_at();
create trigger equipamentos_esterilizacao_set_updated_at before update on public.equipamentos_esterilizacao for each row execute function public.set_updated_at();
create trigger ciclos_esterilizacao_set_updated_at before update on public.ciclos_esterilizacao for each row execute function public.set_updated_at();
create trigger pacotes_esterilizacao_set_updated_at before update on public.pacotes_esterilizacao for each row execute function public.set_updated_at();

alter table public.materiais_lotes enable row level security;
alter table public.movimentacoes_lotes enable row level security;
alter table public.equipamentos_esterilizacao enable row level security;
alter table public.ciclos_esterilizacao enable row level security;
alter table public.pacotes_esterilizacao enable row level security;

create policy materiais_lotes_select on public.materiais_lotes for select to authenticated using (public.is_active_user());
create policy movimentacoes_lotes_select on public.movimentacoes_lotes for select to authenticated using (
  public.is_active_user() and exists (
    select 1 from public.movimentacoes_estoque movimento
    where movimento.id = movimentacao_id
      and (public.is_admin() or public.is_active_reception() or (public.is_active_dentist() and movimento.created_by = (select auth.uid())))
  )
);
create policy equipamentos_esterilizacao_select on public.equipamentos_esterilizacao for select to authenticated using (public.is_active_user());
create policy ciclos_esterilizacao_select on public.ciclos_esterilizacao for select to authenticated using (public.is_active_user());
create policy pacotes_esterilizacao_select on public.pacotes_esterilizacao for select to authenticated using (public.is_active_user());

revoke insert, update, delete on public.materiais_lotes, public.movimentacoes_lotes, public.equipamentos_esterilizacao, public.ciclos_esterilizacao, public.pacotes_esterilizacao from anon, authenticated;
grant select on public.materiais_lotes, public.movimentacoes_lotes, public.equipamentos_esterilizacao, public.ciclos_esterilizacao, public.pacotes_esterilizacao to authenticated;
grant all on public.materiais_lotes, public.movimentacoes_lotes, public.equipamentos_esterilizacao, public.ciclos_esterilizacao, public.pacotes_esterilizacao to service_role;

create function public.clinic_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Cuiaba')::date;
$$;

create function public.validity_status(p_quantidade integer, p_ativo boolean, p_data_validade date)
returns text language sql stable set search_path = '' as $$
  select case
    when not coalesce(p_ativo, false) then 'inativo'
    when coalesce(p_quantidade, 0) = 0 then 'esgotado'
    when p_data_validade < public.clinic_today() then 'vencido'
    when p_data_validade <= public.clinic_today() + 30 then 'proximo_do_vencimento'
    else 'valido'
  end;
$$;

create function public.package_effective_status(
  p_status public.status_pacote_esterilizacao,
  p_validade date
)
returns text language sql stable set search_path = '' as $$
  select case
    when p_status = 'utilizado' then 'utilizado'
    when p_status = 'descartado' then 'descartado'
    when p_status = 'pendente' then 'pendente'
    when p_validade < public.clinic_today() then 'vencido'
    when p_validade <= public.clinic_today() + 30 then 'proximo_do_vencimento'
    else 'valido'
  end;
$$;

create function public.assert_lot_stock_balance(p_material_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_aggregate integer; v_lots bigint; v_controlled boolean;
begin
  select quantidade_atual, controla_lote_validade into v_aggregate, v_controlled
  from public.materiais_estoque where id = p_material_id;
  if not found then raise exception 'Material nao encontrado.' using errcode = 'P0002'; end if;
  if v_controlled then
    select coalesce(sum(quantidade_atual), 0) into v_lots from public.materiais_lotes where material_id = p_material_id;
    if v_lots <> v_aggregate then raise exception 'LOT_BALANCE_DIVERGENT' using errcode = 'P0001'; end if;
  end if;
end;
$$;

create function public.set_stock_lot_control(
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
  if v_material.controla_lote_validade = p_controla then return v_material; end if;
  if p_controla then
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

create function public.register_stock_lot_entry(
  p_material_id uuid, p_codigo_lote text, p_quantidade integer, p_data_validade date,
  p_data_fabricacao date default null, p_fornecedor text default null,
  p_motivo text default null, p_referencia text default null
)
returns public.movimentacoes_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype; v_lote public.materiais_lotes%rowtype;
  v_movement public.movimentacoes_estoque%rowtype; v_before_lot integer; v_after_material integer;
  v_code text := nullif(btrim(p_codigo_lote), ''); v_supplier text := nullif(btrim(p_fornecedor), '');
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Entrada por lote nao autorizada.' using errcode = '42501'; end if;
  if v_code is null or p_data_validade is null or coalesce(p_quantidade, 0) <= 0 or p_quantidade > 1000000 then raise exception 'Dados do lote invalidos.' using errcode = '23514'; end if;
  if p_data_fabricacao is not null and p_data_fabricacao > p_data_validade then raise exception 'Datas do lote invalidas.' using errcode = '23514'; end if;
  select * into v_material from public.materiais_estoque where id = p_material_id for update;
  if not found or not v_material.ativo or not v_material.controla_lote_validade then raise exception 'Material nao aceita entrada por lote.' using errcode = '23514'; end if;
  select * into v_lote from public.materiais_lotes where material_id = v_material.id and codigo_lote = v_code for update;
  if found then
    if not v_lote.ativo or v_lote.data_validade is distinct from p_data_validade or v_lote.data_fabricacao is distinct from p_data_fabricacao or v_lote.fornecedor is distinct from v_supplier then
      raise exception 'Metadados conflitantes para o lote existente.' using errcode = '23514';
    end if;
    if v_lote.quantidade_inicial + p_quantidade > 1000000 then raise exception 'Quantidade do lote excede o limite.' using errcode = '23514'; end if;
    v_before_lot := v_lote.quantidade_atual;
    update public.materiais_lotes set quantidade_inicial = quantidade_inicial + p_quantidade, quantidade_atual = quantidade_atual + p_quantidade, updated_by = v_actor where id = v_lote.id returning * into v_lote;
  else
    v_before_lot := 0;
    insert into public.materiais_lotes(material_id, codigo_lote, quantidade_inicial, quantidade_atual, data_fabricacao, data_validade, fornecedor, created_by, updated_by)
    values(v_material.id, v_code, p_quantidade, p_quantidade, p_data_fabricacao, p_data_validade, v_supplier, v_actor, v_actor) returning * into v_lote;
  end if;
  if v_material.quantidade_atual + p_quantidade > 1000000 then raise exception 'Saldo agregado excede o limite.' using errcode = '23514'; end if;
  v_after_material := v_material.quantidade_atual + p_quantidade;
  update public.materiais_estoque set quantidade_atual = v_after_material, updated_by = v_actor where id = v_material.id;
  insert into public.movimentacoes_estoque(material_id, tipo, quantidade, motivo, referencia, quantidade_anterior, quantidade_posterior, created_by)
  values(v_material.id, 'entrada', p_quantidade, nullif(btrim(p_motivo), ''), nullif(btrim(p_referencia), ''), v_material.quantidade_atual, v_after_material, v_actor) returning * into v_movement;
  insert into public.movimentacoes_lotes(movimentacao_id, lote_id, quantidade, quantidade_lote_anterior, quantidade_lote_posterior, created_by)
  values(v_movement.id, v_lote.id, p_quantidade, v_before_lot, v_lote.quantidade_atual, v_actor);
  perform public.assert_lot_stock_balance(v_material.id);
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, 'estoque_lote_entrada', 'movimentacoes_estoque', v_movement.id, jsonb_build_object('material_id', v_material.id, 'lote_id', v_lote.id, 'quantidade', p_quantidade));
  return v_movement;
end;
$$;

create function public.register_stock_lot_exit(
  p_material_id uuid, p_lote_id uuid, p_quantidade integer,
  p_finalidade public.finalidade_saida_lote, p_motivo text default null, p_referencia text default null
)
returns public.movimentacoes_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype; v_lote public.materiais_lotes%rowtype;
  v_movement public.movimentacoes_estoque%rowtype; v_after_lot integer; v_after_material integer; v_reason text := nullif(btrim(p_motivo), '');
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Saida por lote nao autorizada.' using errcode = '42501'; end if;
  if coalesce(p_quantidade, 0) <= 0 or p_quantidade > 1000000 then raise exception 'Quantidade invalida.' using errcode = '23514'; end if;
  if p_finalidade in ('descarte','perda') and v_reason is null then raise exception 'Descarte ou perda exige motivo.' using errcode = '23514'; end if;
  select * into v_material from public.materiais_estoque where id = p_material_id for update;
  if not found or not v_material.ativo or not v_material.controla_lote_validade then raise exception 'Material nao aceita saida por lote.' using errcode = '23514'; end if;
  select * into v_lote from public.materiais_lotes where id = p_lote_id and material_id = v_material.id for update;
  if not found or not v_lote.ativo then raise exception 'Lote invalido ou inativo.' using errcode = '23514'; end if;
  if p_finalidade = 'uso' and v_lote.data_validade < public.clinic_today() then raise exception 'Lote vencido nao pode ser consumido.' using errcode = '23514'; end if;
  if v_lote.quantidade_atual < p_quantidade or v_material.quantidade_atual < p_quantidade then raise exception 'Saldo insuficiente no lote.' using errcode = '23514'; end if;
  v_after_lot := v_lote.quantidade_atual - p_quantidade; v_after_material := v_material.quantidade_atual - p_quantidade;
  update public.materiais_lotes set quantidade_atual = v_after_lot, updated_by = v_actor where id = v_lote.id;
  update public.materiais_estoque set quantidade_atual = v_after_material, updated_by = v_actor where id = v_material.id;
  insert into public.movimentacoes_estoque(material_id, tipo, quantidade, motivo, referencia, quantidade_anterior, quantidade_posterior, created_by)
  values(v_material.id, 'saida', p_quantidade, v_reason, nullif(btrim(p_referencia), ''), v_material.quantidade_atual, v_after_material, v_actor) returning * into v_movement;
  insert into public.movimentacoes_lotes(movimentacao_id, lote_id, quantidade, quantidade_lote_anterior, quantidade_lote_posterior, finalidade_saida, created_by)
  values(v_movement.id, v_lote.id, p_quantidade, v_lote.quantidade_atual, v_after_lot, p_finalidade, v_actor);
  perform public.assert_lot_stock_balance(v_material.id);
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, 'estoque_lote_saida', 'movimentacoes_estoque', v_movement.id, jsonb_build_object('material_id', v_material.id, 'lote_id', v_lote.id, 'quantidade', p_quantidade, 'finalidade', p_finalidade));
  return v_movement;
end;
$$;

create function public.set_stock_lot_active(p_lote_id uuid, p_ativo boolean)
returns public.materiais_lotes language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_lote public.materiais_lotes%rowtype;
begin
  if not public.is_admin() then raise exception 'Alteracao de lote nao autorizada.' using errcode = '42501'; end if;
  select * into v_lote from public.materiais_lotes where id = p_lote_id for update;
  if not found then raise exception 'Lote nao encontrado.' using errcode = 'P0002'; end if;
  if not p_ativo and v_lote.quantidade_atual > 0 then raise exception 'Lote com saldo nao pode ser inativado.' using errcode = '23514'; end if;
  update public.materiais_lotes set ativo = p_ativo, updated_by = v_actor where id = v_lote.id returning * into v_lote;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, case when p_ativo then 'lote_ativado' else 'lote_inativado' end, 'materiais_lotes', v_lote.id, jsonb_build_object('material_id', v_lote.material_id));
  return v_lote;
end;
$$;

create function public.update_stock_lot_metadata(
  p_lote_id uuid, p_codigo_lote text, p_data_validade date,
  p_data_fabricacao date default null, p_fornecedor text default null
)
returns public.materiais_lotes language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_lote public.materiais_lotes%rowtype; v_code text := nullif(btrim(p_codigo_lote), '');
begin
  if not public.is_admin() then raise exception 'Correcao de lote nao autorizada.' using errcode = '42501'; end if;
  if v_code is null or p_data_validade is null or (p_data_fabricacao is not null and p_data_fabricacao > p_data_validade) then
    raise exception 'Metadados do lote invalidos.' using errcode = '23514';
  end if;
  update public.materiais_lotes set codigo_lote = v_code, data_validade = p_data_validade,
    data_fabricacao = p_data_fabricacao, fornecedor = nullif(btrim(p_fornecedor), ''), updated_by = v_actor
  where id = p_lote_id returning * into v_lote;
  if not found then raise exception 'Lote nao encontrado.' using errcode = 'P0002'; end if;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, 'lote_atualizado', 'materiais_lotes', v_lote.id, jsonb_build_object('material_id', v_lote.material_id));
  return v_lote;
end;
$$;

create function public.adjust_stock_lot(
  p_material_id uuid, p_lote_id uuid, p_nova_quantidade integer,
  p_motivo text, p_referencia text default null
)
returns public.movimentacoes_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype; v_lote public.materiais_lotes%rowtype;
  v_movement public.movimentacoes_estoque%rowtype; v_after_material integer; v_delta integer; v_reason text := nullif(btrim(p_motivo), '');
begin
  if not public.is_admin() then raise exception 'Ajuste de lote nao autorizado.' using errcode = '42501'; end if;
  if p_nova_quantidade is null or p_nova_quantidade < 0 or p_nova_quantidade > 1000000 or v_reason is null then
    raise exception 'Ajuste exige quantidade valida e motivo.' using errcode = '23514';
  end if;
  select * into v_material from public.materiais_estoque where id = p_material_id for update;
  if not found or not v_material.ativo or not v_material.controla_lote_validade then raise exception 'Material nao aceita ajuste por lote.' using errcode = '23514'; end if;
  select * into v_lote from public.materiais_lotes where id = p_lote_id and material_id = v_material.id for update;
  if not found or not v_lote.ativo then raise exception 'Lote invalido ou inativo.' using errcode = '23514'; end if;
  v_delta := p_nova_quantidade - v_lote.quantidade_atual;
  if v_delta = 0 then raise exception 'A nova quantidade deve ser diferente do saldo atual.' using errcode = '23514'; end if;
  v_after_material := v_material.quantidade_atual + v_delta;
  if v_after_material < 0 or v_after_material > 1000000 then raise exception 'Saldo agregado resultante invalido.' using errcode = '23514'; end if;
  update public.materiais_lotes set quantidade_inicial = greatest(quantidade_inicial, p_nova_quantidade), quantidade_atual = p_nova_quantidade, updated_by = v_actor where id = v_lote.id;
  update public.materiais_estoque set quantidade_atual = v_after_material, updated_by = v_actor where id = v_material.id;
  insert into public.movimentacoes_estoque(material_id, tipo, quantidade, motivo, referencia, quantidade_anterior, quantidade_posterior, created_by)
  values(v_material.id, 'ajuste', v_after_material, v_reason, nullif(btrim(p_referencia), ''), v_material.quantidade_atual, v_after_material, v_actor) returning * into v_movement;
  insert into public.movimentacoes_lotes(movimentacao_id, lote_id, quantidade, quantidade_lote_anterior, quantidade_lote_posterior, created_by)
  values(v_movement.id, v_lote.id, abs(v_delta), v_lote.quantidade_atual, p_nova_quantidade, v_actor);
  perform public.assert_lot_stock_balance(v_material.id);
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, 'estoque_lote_ajuste', 'movimentacoes_estoque', v_movement.id, jsonb_build_object('material_id', v_material.id, 'lote_id', v_lote.id, 'quantidade_anterior', v_lote.quantidade_atual, 'quantidade_posterior', p_nova_quantidade));
  return v_movement;
end;
$$;

-- O fluxo legado continua disponivel apenas para materiais sem lote.
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

create function public.list_validity_lots(
  p_query text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20
)
returns table(
  id uuid, material_id uuid, material_nome text, codigo_lote text, quantidade_atual integer,
  saldo_disponivel integer, data_fabricacao date, data_validade date, fornecedor text,
  ativo boolean, status text, dias_restantes integer, total_count bigint
)
language plpgsql security definer set search_path = '' stable as $$
declare v_page integer := greatest(coalesce(p_page,1),1); v_size integer := least(greatest(coalesce(p_page_size,20),1),100); v_status text := nullif(btrim(p_status),'');
begin
  if not public.is_active_user() then raise exception 'Acesso a validade negado.' using errcode = '42501'; end if;
  if v_status is not null and v_status not in ('valido','proximo_do_vencimento','vencido','esgotado','inativo') then raise exception 'Filtro invalido.' using errcode = '22023'; end if;
  return query
  select lote.id, lote.material_id, material.nome, lote.codigo_lote, lote.quantidade_atual,
    case when lote.ativo and lote.data_validade >= public.clinic_today() then lote.quantidade_atual else 0 end,
    lote.data_fabricacao, lote.data_validade, lote.fornecedor, lote.ativo,
    public.validity_status(lote.quantidade_atual,lote.ativo,lote.data_validade),
    lote.data_validade - public.clinic_today(), count(*) over()
  from public.materiais_lotes lote join public.materiais_estoque material on material.id = lote.material_id
  where (p_query is null or btrim(p_query) = '' or material.nome ilike ('%' || replace(replace(btrim(p_query),'%','\%'),'_','\_') || '%') or lote.codigo_lote ilike ('%' || replace(replace(btrim(p_query),'%','\%'),'_','\_') || '%') or coalesce(lote.fornecedor,'') ilike ('%' || replace(replace(btrim(p_query),'%','\%'),'_','\_') || '%'))
    and (v_status is null or public.validity_status(lote.quantidade_atual,lote.ativo,lote.data_validade) = v_status)
  order by lote.ativo desc, lote.data_validade, material.nome, lote.id
  offset (v_page-1)*v_size limit v_size;
end;
$$;

create function public.get_validity_sterilization_summary()
returns table(lotes_validos bigint, lotes_vencendo bigint, lotes_vencidos bigint, lotes_esgotados bigint, pacotes_validos bigint, pacotes_vencendo bigint, pacotes_vencidos bigint, ciclos_hoje bigint, ciclos_em_andamento bigint, ciclos_reprovados bigint)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Resumo operacional negado.' using errcode = '42501'; end if;
  return query select
    (select count(*) from public.materiais_lotes l where public.validity_status(l.quantidade_atual,l.ativo,l.data_validade)='valido'),
    (select count(*) from public.materiais_lotes l where public.validity_status(l.quantidade_atual,l.ativo,l.data_validade)='proximo_do_vencimento'),
    (select count(*) from public.materiais_lotes l where public.validity_status(l.quantidade_atual,l.ativo,l.data_validade)='vencido'),
    (select count(*) from public.materiais_lotes l where public.validity_status(l.quantidade_atual,l.ativo,l.data_validade)='esgotado'),
    (select count(*) from public.pacotes_esterilizacao p where public.package_effective_status(p.status_operacional,p.validade_ate)='valido'),
    (select count(*) from public.pacotes_esterilizacao p where public.package_effective_status(p.status_operacional,p.validade_ate)='proximo_do_vencimento'),
    (select count(*) from public.pacotes_esterilizacao p where public.package_effective_status(p.status_operacional,p.validade_ate)='vencido'),
    (select count(*) from public.ciclos_esterilizacao c where (c.iniciado_em at time zone 'America/Cuiaba')::date=public.clinic_today()),
    (select count(*) from public.ciclos_esterilizacao c where c.status='em_andamento'),
    (select count(*) from public.ciclos_esterilizacao c where c.status='reprovado' and c.finalizado_em >= now() - interval '30 days');
end;
$$;

create function public.create_sterilization_equipment(p_nome text, p_identificacao text, p_modelo text default null, p_fabricante text default null, p_numero_serie text default null)
returns public.equipamentos_esterilizacao language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.equipamentos_esterilizacao%rowtype;
begin
  if not public.is_admin() then raise exception 'Cadastro de equipamento negado.' using errcode='42501'; end if;
  insert into public.equipamentos_esterilizacao(nome,identificacao,modelo,fabricante,numero_serie,created_by,updated_by)
  values(btrim(coalesce(p_nome,'')),btrim(coalesce(p_identificacao,'')),nullif(btrim(p_modelo),''),nullif(btrim(p_fabricante),''),nullif(btrim(p_numero_serie),''),v_actor,v_actor) returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'equipamento_esterilizacao_criado','equipamentos_esterilizacao',v_result.id,'{}'::jsonb);
  return v_result;
end;
$$;

create function public.set_sterilization_equipment_active(p_equipamento_id uuid, p_ativo boolean)
returns public.equipamentos_esterilizacao language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.equipamentos_esterilizacao%rowtype;
begin
  if not public.is_admin() then raise exception 'Alteracao de equipamento negada.' using errcode='42501'; end if;
  if not p_ativo and exists(select 1 from public.ciclos_esterilizacao where equipamento_id=p_equipamento_id and status='em_andamento') then raise exception 'Equipamento possui ciclo em andamento.' using errcode='23514'; end if;
  update public.equipamentos_esterilizacao set ativo=p_ativo,updated_by=v_actor where id=p_equipamento_id returning * into v_result;
  if not found then raise exception 'Equipamento nao encontrado.' using errcode='P0002'; end if;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'equipamento_esterilizacao_atualizado','equipamentos_esterilizacao',v_result.id,jsonb_build_object('ativo',p_ativo));
  return v_result;
end;
$$;

create function public.start_sterilization_cycle(p_equipamento_id uuid, p_observacoes text default null)
returns public.ciclos_esterilizacao language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.ciclos_esterilizacao%rowtype; v_code text;
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Inicio de ciclo negado.' using errcode='42501'; end if;
  if not exists(select 1 from public.equipamentos_esterilizacao where id=p_equipamento_id and ativo) then raise exception 'Equipamento invalido ou inativo.' using errcode='23514'; end if;
  v_code := 'EST-' || to_char(public.clinic_today(),'YYYYMMDD') || '-' || lpad(nextval('public.ciclos_esterilizacao_numero_seq')::text,6,'0');
  insert into public.ciclos_esterilizacao(codigo,equipamento_id,iniciado_em,responsavel_id,observacoes,created_by,updated_by)
  values(v_code,p_equipamento_id,now(),v_actor,nullif(btrim(p_observacoes),''),v_actor,v_actor) returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'ciclo_esterilizacao_iniciado','ciclos_esterilizacao',v_result.id,jsonb_build_object('equipamento_id',p_equipamento_id));
  return v_result;
end;
$$;

create function public.create_sterilization_package(p_ciclo_id uuid, p_codigo text, p_descricao text, p_validade_ate date)
returns public.pacotes_esterilizacao language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.pacotes_esterilizacao%rowtype;
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Cadastro de pacote negado.' using errcode='42501'; end if;
  if p_validade_ate is null or p_validade_ate < public.clinic_today() then raise exception 'Validade do pacote invalida.' using errcode='23514'; end if;
  if not exists(select 1 from public.ciclos_esterilizacao where id=p_ciclo_id and status='em_andamento') then raise exception 'Ciclo nao permite novos pacotes.' using errcode='23514'; end if;
  insert into public.pacotes_esterilizacao(ciclo_id,codigo,descricao,validade_ate,created_by,updated_by)
  values(p_ciclo_id,btrim(coalesce(p_codigo,'')),btrim(coalesce(p_descricao,'')),p_validade_ate,v_actor,v_actor) returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'pacote_esterilizacao_criado','pacotes_esterilizacao',v_result.id,jsonb_build_object('ciclo_id',p_ciclo_id));
  return v_result;
end;
$$;

create function public.finish_sterilization_cycle(p_ciclo_id uuid, p_status public.status_ciclo_esterilizacao, p_observacoes text default null)
returns public.ciclos_esterilizacao language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.ciclos_esterilizacao%rowtype; v_finished timestamptz:=now(); v_date date:=(v_finished at time zone 'America/Cuiaba')::date; v_event text;
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Finalizacao de ciclo negada.' using errcode='42501'; end if;
  if p_status not in ('concluido','reprovado','cancelado') then raise exception 'Status final invalido.' using errcode='23514'; end if;
  perform 1 from public.ciclos_esterilizacao where id=p_ciclo_id and status='em_andamento' for update;
  if not found then raise exception 'Ciclo nao encontrado ou encerrado.' using errcode='23514'; end if;
  if p_status='concluido' and exists(select 1 from public.pacotes_esterilizacao where ciclo_id=p_ciclo_id and validade_ate<v_date) then raise exception 'Pacote possui validade anterior a esterilizacao.' using errcode='23514'; end if;
  update public.ciclos_esterilizacao set status=p_status,finalizado_em=v_finished,observacoes=coalesce(nullif(btrim(p_observacoes),''),observacoes),updated_by=v_actor where id=p_ciclo_id returning * into v_result;
  if p_status='concluido' then
    update public.pacotes_esterilizacao set status_operacional='ativo',esterilizado_em=v_date,updated_by=v_actor where ciclo_id=p_ciclo_id and status_operacional='pendente';
  else
    update public.pacotes_esterilizacao set status_operacional='descartado',descartado_em=v_finished,descartado_por=v_actor,updated_by=v_actor where ciclo_id=p_ciclo_id and status_operacional='pendente';
  end if;
  v_event:=case p_status when 'concluido' then 'ciclo_esterilizacao_concluido' when 'reprovado' then 'ciclo_esterilizacao_reprovado' else 'ciclo_esterilizacao_cancelado' end;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,v_event,'ciclos_esterilizacao',v_result.id,jsonb_build_object('status',p_status));
  return v_result;
end;
$$;

create function public.set_sterilization_package_status(p_pacote_id uuid, p_status public.status_pacote_esterilizacao)
returns public.pacotes_esterilizacao language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.pacotes_esterilizacao%rowtype;
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Alteracao de pacote negada.' using errcode='42501'; end if;
  if p_status not in ('utilizado','descartado') then raise exception 'Status de pacote invalido.' using errcode='23514'; end if;
  select * into v_result from public.pacotes_esterilizacao where id=p_pacote_id for update;
  if not found or v_result.status_operacional<>'ativo' then raise exception 'Pacote nao pode ser alterado.' using errcode='23514'; end if;
  if p_status='utilizado' and v_result.validade_ate<public.clinic_today() then raise exception 'Pacote vencido nao pode ser utilizado.' using errcode='23514'; end if;
  update public.pacotes_esterilizacao set status_operacional=p_status,
    utilizado_em=case when p_status='utilizado' then now() else null end, utilizado_por=case when p_status='utilizado' then v_actor else null end,
    descartado_em=case when p_status='descartado' then now() else null end, descartado_por=case when p_status='descartado' then v_actor else null end,
    updated_by=v_actor where id=p_pacote_id returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,case when p_status='utilizado' then 'pacote_esterilizacao_utilizado' else 'pacote_esterilizacao_descartado' end,'pacotes_esterilizacao',v_result.id,jsonb_build_object('status',p_status));
  return v_result;
end;
$$;

-- Bloqueio preventivo: a baixa clinica automatica ainda nao escolhe lotes.
create or replace function public.finalize_attendance(p_atendimento_id uuid, p_evolucao text)
returns public.atendimentos language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_professional_id uuid := public.current_professional_id();
  v_before public.atendimentos%rowtype; v_after public.atendimentos%rowtype; v_appointment public.agendamentos%rowtype;
  v_evolution text := nullif(btrim(p_evolucao), ''); v_material record; v_consumption record; v_current integer; v_after_quantity integer;
begin
  if v_professional_id is null then raise exception 'Acesso clinico negado.' using errcode='42501'; end if;
  if v_evolution is null then raise exception 'Evolucao obrigatoria para finalizar.' using errcode='23514'; end if;
  select * into v_before from public.atendimentos where id=p_atendimento_id for update;
  if not found then raise exception 'Atendimento nao encontrado.' using errcode='P0002'; end if;
  if v_before.profissional_id<>v_professional_id then raise exception 'Acesso clinico negado.' using errcode='42501'; end if;
  if v_before.status<>'em_andamento' then raise exception 'Atendimento ja finalizado.' using errcode='23514'; end if;
  if exists(
    select 1 from public.procedimento_materiais_consumo consumo
    join public.procedimentos procedimento on procedimento.id=consumo.procedimento_id
    join public.materiais_estoque material on material.id=consumo.material_id
    where procedimento.atendimento_id=v_before.id and material.controla_lote_validade
  ) then raise exception 'LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING' using errcode='P0001'; end if;
  if v_before.agendamento_id is not null then
    select * into v_appointment from public.agendamentos where id=v_before.agendamento_id for update;
    if v_appointment.status not in ('agendado','confirmado') then raise exception 'Status do agendamento impede finalizacao.' using errcode='23514'; end if;
  end if;
  for v_material in
    select material.id,material.nome,material.quantidade_atual,material.ativo,consumo.necessario
    from (select item.material_id,sum(item.quantidade_total)::integer necessario from public.procedimento_materiais_consumo item join public.procedimentos procedimento on procedimento.id=item.procedimento_id where procedimento.atendimento_id=v_before.id group by item.material_id) consumo
    join public.materiais_estoque material on material.id=consumo.material_id order by material.id for update of material
  loop
    if not v_material.ativo then raise exception 'STOCK_MATERIAL_INACTIVE:%',v_material.id using errcode='P0001'; end if;
    if v_material.quantidade_atual<v_material.necessario then raise exception 'STOCK_INSUFFICIENT:%:%:%',v_material.id,v_material.quantidade_atual,v_material.necessario using errcode='P0001'; end if;
  end loop;
  for v_consumption in
    select item.id consumo_id,item.material_id,item.quantidade_total,item.procedimento_id from public.procedimento_materiais_consumo item join public.procedimentos procedimento on procedimento.id=item.procedimento_id where procedimento.atendimento_id=v_before.id order by item.material_id,item.id
  loop
    select quantidade_atual into v_current from public.materiais_estoque where id=v_consumption.material_id for update;
    v_after_quantity:=v_current-v_consumption.quantidade_total;
    update public.materiais_estoque set quantidade_atual=v_after_quantity,updated_by=v_actor_id where id=v_consumption.material_id;
    insert into public.movimentacoes_estoque(material_id,tipo,quantidade,motivo,referencia,quantidade_anterior,quantidade_posterior,atendimento_id,procedimento_id,procedimento_material_consumo_id,created_by)
    values(v_consumption.material_id,'saida',v_consumption.quantidade_total,null,'Consumo automatico por atendimento',v_current,v_after_quantity,v_before.id,v_consumption.procedimento_id,v_consumption.consumo_id,v_actor_id);
    insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor_id,'estoque_consumido_atendimento','movimentacoes_estoque',v_consumption.consumo_id,jsonb_build_object('atendimento_id',v_before.id,'material_id',v_consumption.material_id));
  end loop;
  update public.atendimentos set evolucao=v_evolution,status='finalizado',finalizado_em=now(),updated_by=v_actor_id where id=p_atendimento_id returning * into v_after;
  if v_before.agendamento_id is not null then
    update public.agendamentos set status='atendido',updated_by=v_actor_id where id=v_before.agendamento_id;
    insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor_id,'agendamento_atendido','agendamentos',v_before.agendamento_id,jsonb_build_object('atendimento_id',v_after.id,'status_novo','atendido'));
  end if;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor_id,'atendimento_finalizado','atendimentos',v_after.id,jsonb_build_object('agendamento_id',v_after.agendamento_id,'paciente_id',v_after.paciente_id,'profissional_id',v_after.profissional_id));
  return v_after;
end;
$$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','procedimento_dentes_atualizados',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado',
  'pagamento_criado','pagamento_cancelado','pagamento_estornado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado',
  'servico_criado','servico_atualizado','servico_ativado','servico_inativado','servico_materiais_alterado','servico_realizado','servico_realizado_atualizado','estoque_consumido_atendimento',
  'controle_lote_ativado','controle_lote_desativado','estoque_lote_entrada','estoque_lote_saida','estoque_lote_ajuste','lote_atualizado','lote_ativado','lote_inativado',
  'equipamento_esterilizacao_criado','equipamento_esterilizacao_atualizado','ciclo_esterilizacao_iniciado','ciclo_esterilizacao_concluido','ciclo_esterilizacao_reprovado','ciclo_esterilizacao_cancelado','pacote_esterilizacao_criado','pacote_esterilizacao_utilizado','pacote_esterilizacao_descartado'
));

revoke execute on function public.clinic_today(), public.validity_status(integer,boolean,date), public.package_effective_status(public.status_pacote_esterilizacao,date), public.assert_lot_stock_balance(uuid), public.set_stock_lot_control(uuid,boolean,text,date,date,text), public.register_stock_lot_entry(uuid,text,integer,date,date,text,text,text), public.register_stock_lot_exit(uuid,uuid,integer,public.finalidade_saida_lote,text,text), public.set_stock_lot_active(uuid,boolean), public.update_stock_lot_metadata(uuid,text,date,date,text), public.adjust_stock_lot(uuid,uuid,integer,text,text), public.list_validity_lots(text,text,integer,integer), public.get_validity_sterilization_summary(), public.create_sterilization_equipment(text,text,text,text,text), public.set_sterilization_equipment_active(uuid,boolean), public.start_sterilization_cycle(uuid,text), public.create_sterilization_package(uuid,text,text,date), public.finish_sterilization_cycle(uuid,public.status_ciclo_esterilizacao,text), public.set_sterilization_package_status(uuid,public.status_pacote_esterilizacao) from public, anon, authenticated;
grant execute on function public.clinic_today(), public.validity_status(integer,boolean,date), public.package_effective_status(public.status_pacote_esterilizacao,date), public.set_stock_lot_control(uuid,boolean,text,date,date,text), public.register_stock_lot_entry(uuid,text,integer,date,date,text,text,text), public.register_stock_lot_exit(uuid,uuid,integer,public.finalidade_saida_lote,text,text), public.set_stock_lot_active(uuid,boolean), public.update_stock_lot_metadata(uuid,text,date,date,text), public.adjust_stock_lot(uuid,uuid,integer,text,text), public.list_validity_lots(text,text,integer,integer), public.get_validity_sterilization_summary(), public.create_sterilization_equipment(text,text,text,text,text), public.set_sterilization_equipment_active(uuid,boolean), public.start_sterilization_cycle(uuid,text), public.create_sterilization_package(uuid,text,text,date), public.finish_sterilization_cycle(uuid,public.status_ciclo_esterilizacao,text), public.set_sterilization_package_status(uuid,public.status_pacote_esterilizacao) to authenticated;

comment on table public.controle_validade is 'LEGADO/WIP historico das migrations 0007/0008. O modulo funcional usa as estruturas da migration 0017.';
comment on table public.materiais_lotes is 'Saldo fisico por lote. Para materiais controlados, a soma deve ser igual ao saldo agregado em materiais_estoque.';
comment on table public.movimentacoes_lotes is 'Detalhes 1..N da movimentacao agregada, preparados para consumo FEFO multi-lote futuro.';

commit;
