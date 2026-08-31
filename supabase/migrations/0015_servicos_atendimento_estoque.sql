-- Sprint 13: catalogo de servicos, consumo configuravel e finalizacao atomica.
-- Aditiva: preserva todas as migrations 0001-0014 e procedimentos historicos.

begin;

create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  categoria text,
  valor_padrao_centavos integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint servicos_nome_valido check (nome = btrim(nome) and char_length(nome) between 2 and 200),
  constraint servicos_descricao_valida check (descricao is null or (descricao = btrim(descricao) and char_length(descricao) between 1 and 1000)),
  constraint servicos_categoria_valida check (categoria is null or (categoria = btrim(categoria) and char_length(categoria) between 2 and 100)),
  constraint servicos_valor_padrao_valido check (valor_padrao_centavos between 0 and 100000000)
);

create table public.servico_materiais (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos(id) on delete restrict,
  material_id uuid not null references public.materiais_estoque(id) on delete restrict,
  quantidade_padrao integer not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint servico_materiais_quantidade_valida check (quantidade_padrao between 1 and 1000000),
  constraint servico_materiais_unico unique (servico_id, material_id)
);

-- Procedimentos em texto livre continuam validos. Os novos campos so sao
-- preenchidos para servicos selecionados a partir do catalogo.
alter table public.procedimentos
  add column servico_id uuid references public.servicos(id) on delete restrict,
  add column quantidade integer not null default 1,
  add column valor_aplicado_centavos integer;

alter table public.procedimentos
  add constraint procedimentos_quantidade_valida check (quantidade between 1 and 1000000),
  add constraint procedimentos_servico_valor_consistente check (
    (servico_id is null and valor_aplicado_centavos is null)
    or (servico_id is not null and valor_aplicado_centavos between 0 and 100000000)
  );

-- Snapshot imutavel da composicao ativa no momento em que o servico e
-- registrado. Alterar o catalogo depois disso nao altera consumo pendente ou
-- historico clinico.
create table public.procedimento_materiais_consumo (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.procedimentos(id) on delete restrict,
  servico_material_id uuid not null references public.servico_materiais(id) on delete restrict,
  material_id uuid not null references public.materiais_estoque(id) on delete restrict,
  quantidade_por_servico integer not null,
  quantidade_total integer not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  constraint procedimento_materiais_consumo_quantidade_unidade_valida check (quantidade_por_servico between 1 and 1000000),
  constraint procedimento_materiais_consumo_quantidade_total_valida check (quantidade_total between 1 and 1000000),
  constraint procedimento_materiais_consumo_unico unique (procedimento_id, material_id)
);

alter table public.movimentacoes_estoque
  add column atendimento_id uuid references public.atendimentos(id) on delete restrict,
  add column procedimento_id uuid references public.procedimentos(id) on delete restrict,
  add column procedimento_material_consumo_id uuid references public.procedimento_materiais_consumo(id) on delete restrict;

alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_origem_atendimento_consistente check (
    (atendimento_id is null and procedimento_id is null and procedimento_material_consumo_id is null)
    or (atendimento_id is not null and procedimento_id is not null and procedimento_material_consumo_id is not null)
  );

create unique index movimentacoes_estoque_consumo_unico_idx
  on public.movimentacoes_estoque(procedimento_material_consumo_id)
  where procedimento_material_consumo_id is not null;
create index servicos_listagem_idx on public.servicos(ativo, nome, id);
create index procedimento_materiais_consumo_procedimento_idx
  on public.procedimento_materiais_consumo(procedimento_id, material_id);
create index movimentacoes_estoque_atendimento_data_idx
  on public.movimentacoes_estoque(atendimento_id, created_at desc, id)
  where atendimento_id is not null;

create trigger servicos_set_updated_at before update on public.servicos
  for each row execute function public.set_updated_at();
create trigger servico_materiais_set_updated_at before update on public.servico_materiais
  for each row execute function public.set_updated_at();

alter table public.servicos enable row level security;
alter table public.servico_materiais enable row level security;
alter table public.procedimento_materiais_consumo enable row level security;

create policy servicos_select_authorized on public.servicos for select to authenticated
  using (public.is_active_user() and (public.is_admin() or (public.is_active_dentist() and ativo)));
create policy servico_materiais_select_authorized on public.servico_materiais for select to authenticated
  using (public.is_active_user() and (public.is_admin() or public.is_active_dentist()));
create policy procedimento_materiais_consumo_select_own_dentist
  on public.procedimento_materiais_consumo for select to authenticated
  using (
    public.is_active_dentist()
    and exists (
      select 1 from public.procedimentos procedimento
      join public.atendimentos atendimento on atendimento.id = procedimento.atendimento_id
      where procedimento.id = procedimento_materiais_consumo.procedimento_id
        and atendimento.profissional_id = public.current_professional_id()
    )
  );

revoke insert, update, delete on public.servicos, public.servico_materiais, public.procedimento_materiais_consumo from anon, authenticated;
grant select on public.servicos, public.servico_materiais, public.procedimento_materiais_consumo to authenticated;
grant all on public.servicos, public.servico_materiais, public.procedimento_materiais_consumo to service_role;

create function public.create_service(
  p_nome text,
  p_descricao text default null,
  p_categoria text default null,
  p_valor_padrao_centavos integer default 0
)
returns public.servicos
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_result public.servicos%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
  if coalesce(p_valor_padrao_centavos, -1) < 0 or p_valor_padrao_centavos > 100000000 then
    raise exception 'Valor padrao invalido.' using errcode = '23514';
  end if;
  insert into public.servicos(nome, descricao, categoria, valor_padrao_centavos, created_by, updated_by)
  values (btrim(coalesce(p_nome, '')), nullif(btrim(p_descricao), ''), nullif(btrim(p_categoria), ''), p_valor_padrao_centavos, v_actor, v_actor)
  returning * into v_result;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'servico_criado', 'servicos', v_result.id, '{}'::jsonb);
  return v_result;
end;
$$;

create function public.update_service(
  p_servico_id uuid,
  p_nome text,
  p_descricao text default null,
  p_categoria text default null,
  p_valor_padrao_centavos integer default 0
)
returns public.servicos
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_before public.servicos%rowtype;
  v_result public.servicos%rowtype;
  v_changed jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
  if coalesce(p_valor_padrao_centavos, -1) < 0 or p_valor_padrao_centavos > 100000000 then
    raise exception 'Valor padrao invalido.' using errcode = '23514';
  end if;
  select * into v_before from public.servicos where id = p_servico_id for update;
  if not found then raise exception 'Servico nao encontrado.' using errcode = 'P0002'; end if;
  if v_before.nome is distinct from btrim(coalesce(p_nome, '')) then v_changed := v_changed || jsonb_build_array('nome'); end if;
  if v_before.descricao is distinct from nullif(btrim(p_descricao), '') then v_changed := v_changed || jsonb_build_array('descricao'); end if;
  if v_before.categoria is distinct from nullif(btrim(p_categoria), '') then v_changed := v_changed || jsonb_build_array('categoria'); end if;
  if v_before.valor_padrao_centavos is distinct from p_valor_padrao_centavos then v_changed := v_changed || jsonb_build_array('valor_padrao_centavos'); end if;
  update public.servicos set nome = btrim(coalesce(p_nome, '')), descricao = nullif(btrim(p_descricao), ''), categoria = nullif(btrim(p_categoria), ''), valor_padrao_centavos = p_valor_padrao_centavos, updated_by = v_actor
  where id = p_servico_id returning * into v_result;
  if jsonb_array_length(v_changed) > 0 then
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (v_actor, 'servico_atualizado', 'servicos', v_result.id, jsonb_build_object('campos_alterados', v_changed));
  end if;
  return v_result;
end;
$$;

create function public.set_service_active(p_servico_id uuid, p_ativo boolean)
returns public.servicos
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.servicos%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
  update public.servicos set ativo = p_ativo, updated_by = v_actor where id = p_servico_id returning * into v_result;
  if not found then raise exception 'Servico nao encontrado.' using errcode = 'P0002'; end if;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, case when p_ativo then 'servico_ativado' else 'servico_inativado' end, 'servicos', v_result.id, '{}'::jsonb);
  return v_result;
end;
$$;

create function public.configure_service_material(
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
  if not exists (select 1 from public.servicos where id = p_servico_id) then raise exception 'Servico nao encontrado.' using errcode = 'P0002'; end if;
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

create function public.set_service_material_active(p_servico_material_id uuid, p_ativo boolean)
returns public.servico_materiais
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.servico_materiais%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
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

create function public.list_services(
  p_query text default null,
  p_status text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table(
  id uuid, nome text, descricao text, categoria text, valor_padrao_centavos integer,
  ativo boolean, total_count bigint
)
language plpgsql security definer set search_path = '' stable as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_status text := nullif(btrim(p_status), '');
begin
  if not (public.is_admin() or public.is_active_dentist()) then raise exception 'Acesso ao catalogo negado.' using errcode = '42501'; end if;
  if v_status is not null and v_status not in ('ativo', 'inativo', 'todos') then raise exception 'Filtro invalido.' using errcode = '22023'; end if;
  return query
  select servico.id, servico.nome, servico.descricao, servico.categoria, servico.valor_padrao_centavos, servico.ativo, count(*) over()
  from public.servicos servico
  where (public.is_admin() or servico.ativo)
    and (p_query is null or btrim(p_query) = '' or servico.nome ilike ('%' || replace(replace(btrim(p_query), '%', '\\%'), '_', '\\_') || '%'))
    and (v_status is null or v_status = 'todos' or (v_status = 'ativo' and servico.ativo) or (v_status = 'inativo' and not servico.ativo))
  order by servico.ativo desc, servico.nome, servico.id
  offset (v_page - 1) * v_size limit v_size;
end;
$$;

create function public.list_service_materials(p_servico_id uuid)
returns table(id uuid, material_id uuid, material_nome text, quantidade_padrao integer, ativo boolean)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_admin() then raise exception 'Acesso a composicao negado.' using errcode = '42501'; end if;
  return query
  select composicao.id, composicao.material_id, material.nome, composicao.quantidade_padrao, composicao.ativo
  from public.servico_materiais composicao
  join public.materiais_estoque material on material.id = composicao.material_id
  where composicao.servico_id = p_servico_id
  order by composicao.ativo desc, material.nome, composicao.id;
end;
$$;

create function public.create_service_procedure(
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
begin
  if v_profissional is null then raise exception 'Acesso clinico negado.' using errcode = '42501'; end if;
  if coalesce(p_quantidade, 0) < 1 or p_quantidade > 1000000 then raise exception 'Quantidade invalida.' using errcode = '23514'; end if;
  select * into v_atendimento from public.atendimentos where id = p_atendimento_id for update;
  if not found then raise exception 'Atendimento nao encontrado.' using errcode = 'P0002'; end if;
  if v_atendimento.profissional_id <> v_profissional or v_atendimento.status <> 'em_andamento' then raise exception 'Atendimento nao pode ser alterado.' using errcode = '42501'; end if;
  select * into v_servico from public.servicos where id = p_servico_id for key share;
  if not found or not v_servico.ativo then raise exception 'Servico invalido ou inativo.' using errcode = '23514'; end if;
  v_valor := coalesce(p_valor_aplicado_centavos, v_servico.valor_padrao_centavos);
  if v_valor < 0 or v_valor > 100000000 then raise exception 'Valor aplicado invalido.' using errcode = '23514'; end if;
  if p_detalhes is not null and (p_detalhes <> btrim(p_detalhes) or char_length(p_detalhes) > 2000) then raise exception 'Detalhes invalidos.' using errcode = '23514'; end if;
  if exists (
    select 1 from public.servico_materiais composicao
    join public.materiais_estoque material on material.id = composicao.material_id
    where composicao.servico_id = v_servico.id and composicao.ativo and not material.ativo
  ) then raise exception 'Servico possui material inativo.' using errcode = '23514'; end if;
  if exists (
    select 1 from public.servico_materiais composicao
    where composicao.servico_id = v_servico.id
      and composicao.ativo
      and composicao.quantidade_padrao > 1000000 / p_quantidade
  ) then raise exception 'Quantidade total de consumo invalida.' using errcode = '23514'; end if;
  insert into public.procedimentos(atendimento_id, descricao, detalhes, servico_id, quantidade, valor_aplicado_centavos, created_by, updated_by)
  values (v_atendimento.id, v_servico.nome, nullif(btrim(p_detalhes), ''), v_servico.id, p_quantidade, v_valor, v_actor, v_actor)
  returning * into v_result;
  insert into public.procedimento_materiais_consumo(procedimento_id, servico_material_id, material_id, quantidade_por_servico, quantidade_total, created_by)
  select v_result.id, composicao.id, composicao.material_id, composicao.quantidade_padrao, composicao.quantidade_padrao * p_quantidade, v_actor
  from public.servico_materiais composicao
  where composicao.servico_id = v_servico.id and composicao.ativo;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'servico_realizado', 'procedimentos', v_result.id, jsonb_build_object('atendimento_id', v_atendimento.id, 'servico_id', v_servico.id, 'quantidade', p_quantidade));
  return v_result;
end;
$$;

create function public.update_service_procedure(
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
    where consumo.procedimento_id = v_before.id
      and consumo.quantidade_por_servico > 1000000 / p_quantidade
  ) then raise exception 'Quantidade total de consumo invalida.' using errcode = '23514'; end if;
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

create function public.preview_attendance_finalization(p_atendimento_id uuid)
returns table(material_id uuid, material_nome text, necessario integer, disponivel integer, saldo_apos integer, suficiente boolean)
language plpgsql security definer set search_path = '' stable as $$
declare v_profissional uuid := public.current_professional_id(); v_atendimento public.atendimentos%rowtype;
begin
  if v_profissional is null then raise exception 'Acesso clinico negado.' using errcode = '42501'; end if;
  select * into v_atendimento from public.atendimentos where id = p_atendimento_id;
  if not found or v_atendimento.profissional_id <> v_profissional or v_atendimento.status <> 'em_andamento' then raise exception 'Atendimento nao encontrado ou encerrado.' using errcode = '42501'; end if;
  return query
  select material.id, material.nome, consumo.necessario::integer, material.quantidade_atual,
    greatest(material.quantidade_atual - consumo.necessario, 0)::integer,
    (material.ativo and material.quantidade_atual >= consumo.necessario)
  from (
    select item.material_id, sum(item.quantidade_total)::integer as necessario
    from public.procedimento_materiais_consumo item
    join public.procedimentos procedimento on procedimento.id = item.procedimento_id
    where procedimento.atendimento_id = p_atendimento_id
    group by item.material_id
  ) consumo
  join public.materiais_estoque material on material.id = consumo.material_id
  order by material.nome, material.id;
end;
$$;

-- Mantem a mesma assinatura publica usada pela aplicacao. A transacao agora
-- inclui o consumo snapshotado e bloqueia materiais em ordem deterministica.
create or replace function public.finalize_attendance(
  p_atendimento_id uuid,
  p_evolucao text
)
returns public.atendimentos
language plpgsql security definer set search_path = '' as $$
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
begin
  if v_professional_id is null then raise exception 'Acesso clinico negado.' using errcode = '42501'; end if;
  if v_evolution is null then raise exception 'Evolucao obrigatoria para finalizar.' using errcode = '23514'; end if;
  select * into v_before from public.atendimentos where id = p_atendimento_id for update;
  if not found then raise exception 'Atendimento nao encontrado.' using errcode = 'P0002'; end if;
  if v_before.profissional_id <> v_professional_id then raise exception 'Acesso clinico negado.' using errcode = '42501'; end if;
  if v_before.status <> 'em_andamento' then raise exception 'Atendimento ja finalizado.' using errcode = '23514'; end if;
  if v_before.agendamento_id is not null then
    select * into v_appointment from public.agendamentos where id = v_before.agendamento_id for update;
    if v_appointment.status not in ('agendado', 'confirmado') then raise exception 'Status do agendamento impede finalizacao.' using errcode = '23514'; end if;
  end if;
  -- Preflight sob lock: cada material e travado em ordem estavel antes de
  -- qualquer escrita, impedindo saldo negativo em finalizacoes concorrentes.
  for v_material in
    select material.id, material.nome, material.quantidade_atual, material.ativo, consumo.necessario
    from (
      select item.material_id, sum(item.quantidade_total)::integer as necessario
      from public.procedimento_materiais_consumo item
      join public.procedimentos procedimento on procedimento.id = item.procedimento_id
      where procedimento.atendimento_id = v_before.id
      group by item.material_id
    ) consumo
    join public.materiais_estoque material on material.id = consumo.material_id
    order by material.id
    for update of material
  loop
    if not v_material.ativo then raise exception 'STOCK_MATERIAL_INACTIVE:%', v_material.id using errcode = 'P0001'; end if;
    if v_material.quantidade_atual < v_material.necessario then
      raise exception 'STOCK_INSUFFICIENT:%:%:%', v_material.id, v_material.quantidade_atual, v_material.necessario using errcode = 'P0001';
    end if;
  end loop;
  for v_consumption in
    select item.id as consumo_id, item.material_id, item.quantidade_total, item.procedimento_id
    from public.procedimento_materiais_consumo item
    join public.procedimentos procedimento on procedimento.id = item.procedimento_id
    where procedimento.atendimento_id = v_before.id
    order by item.material_id, item.id
  loop
    select quantidade_atual into v_current from public.materiais_estoque where id = v_consumption.material_id for update;
    v_after_quantity := v_current - v_consumption.quantidade_total;
    update public.materiais_estoque set quantidade_atual = v_after_quantity, updated_by = v_actor_id where id = v_consumption.material_id;
    insert into public.movimentacoes_estoque(material_id, tipo, quantidade, motivo, referencia, quantidade_anterior, quantidade_posterior, atendimento_id, procedimento_id, procedimento_material_consumo_id, created_by)
    values (v_consumption.material_id, 'saida', v_consumption.quantidade_total, null, 'Consumo automatico por atendimento', v_current, v_after_quantity, v_before.id, v_consumption.procedimento_id, v_consumption.consumo_id, v_actor_id);
    insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values (v_actor_id, 'estoque_consumido_atendimento', 'movimentacoes_estoque', v_consumption.consumo_id, jsonb_build_object('atendimento_id', v_before.id, 'material_id', v_consumption.material_id));
  end loop;
  update public.atendimentos set evolucao = v_evolution, status = 'finalizado', finalizado_em = now(), updated_by = v_actor_id where id = p_atendimento_id returning * into v_after;
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
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado',
  'pagamento_criado','pagamento_cancelado','pagamento_estornado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado',
  'servico_criado','servico_atualizado','servico_ativado','servico_inativado','servico_materiais_alterado','servico_realizado','servico_realizado_atualizado','estoque_consumido_atendimento'
));

revoke execute on function public.create_service(text, text, text, integer), public.update_service(uuid, text, text, text, integer), public.set_service_active(uuid, boolean), public.configure_service_material(uuid, uuid, integer, boolean), public.set_service_material_active(uuid, boolean), public.list_services(text, text, integer, integer), public.list_service_materials(uuid), public.create_service_procedure(uuid, uuid, integer, integer, text), public.update_service_procedure(uuid, integer, integer, text), public.preview_attendance_finalization(uuid), public.finalize_attendance(uuid, text) from public, anon;
grant execute on function public.create_service(text, text, text, integer), public.update_service(uuid, text, text, text, integer), public.set_service_active(uuid, boolean), public.configure_service_material(uuid, uuid, integer, boolean), public.set_service_material_active(uuid, boolean), public.list_services(text, text, integer, integer), public.list_service_materials(uuid), public.create_service_procedure(uuid, uuid, integer, integer, text), public.update_service_procedure(uuid, integer, integer, text), public.preview_attendance_finalization(uuid), public.finalize_attendance(uuid, text) to authenticated;

commit;
