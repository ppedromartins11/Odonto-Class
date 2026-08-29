-- Sprint 12: estoque simples e compartilhado da clinica.
-- Aditiva: migrations anteriores permanecem imutaveis.
begin;

do $$ begin
  create type public.unidade_estoque as enum ('unidade', 'caixa', 'pacote', 'frasco', 'kit', 'outro');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.tipo_movimentacao_estoque as enum ('entrada', 'saida', 'ajuste');
exception when duplicate_object then null;
end $$;

-- As tabelas podem existir por uma aplicacao anterior sem registro da migration.
-- A definicao abaixo permanece a fonte de verdade para instalacoes novas; em uma
-- homologacao ja existente, os objetos complementares abaixo convergem o schema.
create table if not exists public.materiais_estoque (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null,
  unidade public.unidade_estoque not null default 'unidade',
  quantidade_atual integer not null default 0,
  estoque_minimo integer not null default 0,
  validade date,
  fornecedor text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint materiais_estoque_nome_valido check (nome = btrim(nome) and char_length(nome) between 2 and 200),
  constraint materiais_estoque_categoria_valida check (categoria = btrim(categoria) and char_length(categoria) between 2 and 100),
  constraint materiais_estoque_quantidade_valida check (quantidade_atual >= 0 and quantidade_atual <= 1000000),
  constraint materiais_estoque_minimo_valido check (estoque_minimo >= 0 and estoque_minimo <= 1000000),
  constraint materiais_estoque_fornecedor_valido check (fornecedor is null or (fornecedor = btrim(fornecedor) and char_length(fornecedor) between 2 and 200))
);

create table if not exists public.movimentacoes_estoque (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materiais_estoque(id) on delete restrict,
  tipo public.tipo_movimentacao_estoque not null,
  quantidade integer not null,
  motivo text,
  referencia text,
  quantidade_anterior integer not null,
  quantidade_posterior integer not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  constraint movimentacoes_estoque_quantidade_valida check (
    (tipo in ('entrada', 'saida') and quantidade > 0)
    or (tipo = 'ajuste' and quantidade >= 0)
  ),
  constraint movimentacoes_estoque_saldos_validos check (quantidade_anterior >= 0 and quantidade_posterior >= 0),
  constraint movimentacoes_estoque_motivo_valido check (motivo is null or (motivo = btrim(motivo) and char_length(motivo) between 2 and 500)),
  constraint movimentacoes_estoque_referencia_valida check (referencia is null or (referencia = btrim(referencia) and char_length(referencia) between 2 and 120))
);

comment on table public.materiais_estoque is 'Cadastro compartilhado de materiais. A quantidade somente muda via movimentacao atomica.';
comment on table public.movimentacoes_estoque is 'Historico append-only. Em ajuste, quantidade representa a nova contagem fisica.';

-- Busca e filtros paginados de materiais; o historico e consultado por material/data.
create index if not exists materiais_estoque_listagem_idx on public.materiais_estoque (ativo, categoria, nome, id);
create index if not exists movimentacoes_estoque_material_data_idx on public.movimentacoes_estoque (material_id, created_at desc, id);
create index if not exists movimentacoes_estoque_data_idx on public.movimentacoes_estoque (created_at desc, id);

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.materiais_estoque'::regclass
      and tgname = 'materiais_estoque_set_updated_at'
      and not tgisinternal
  ) then
    create trigger materiais_estoque_set_updated_at before update on public.materiais_estoque
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.materiais_estoque enable row level security;
alter table public.movimentacoes_estoque enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'materiais_estoque'
      and policyname = 'materiais_estoque_select_active'
  ) then
    create policy materiais_estoque_select_active on public.materiais_estoque for select to authenticated
    using (public.is_active_user());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'movimentacoes_estoque'
      and policyname = 'movimentacoes_estoque_select_authorized'
  ) then
    create policy movimentacoes_estoque_select_authorized on public.movimentacoes_estoque for select to authenticated
    using (
      public.is_active_user() and (
        public.is_admin() or public.is_active_reception() or
        (public.is_active_dentist() and created_by = (select auth.uid()))
      )
    );
  end if;
end $$;

revoke insert, update, delete on public.materiais_estoque, public.movimentacoes_estoque from anon, authenticated;
grant select on public.materiais_estoque, public.movimentacoes_estoque to authenticated;
grant all on public.materiais_estoque, public.movimentacoes_estoque to service_role;

create or replace function public.can_operate_stock()
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_admin() or public.is_active_reception() or public.is_active_dentist();
$$;

create or replace function public.create_stock_material(
  p_nome text, p_categoria text, p_unidade public.unidade_estoque,
  p_quantidade_inicial integer, p_estoque_minimo integer,
  p_validade date default null, p_fornecedor text default null, p_ativo boolean default true
)
returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao estoque negado.' using errcode = '42501'; end if;
  if coalesce(p_quantidade_inicial, -1) < 0 or p_quantidade_inicial > 1000000 or coalesce(p_estoque_minimo, -1) < 0 or p_estoque_minimo > 1000000 then
    raise exception 'Quantidade invalida.' using errcode = '23514';
  end if;
  insert into public.materiais_estoque(nome,categoria,unidade,quantidade_atual,estoque_minimo,validade,fornecedor,ativo,created_by,updated_by)
  values (btrim(coalesce(p_nome,'')),btrim(coalesce(p_categoria,'')),coalesce(p_unidade,'unidade'),p_quantidade_inicial,p_estoque_minimo,p_validade,nullif(btrim(p_fornecedor),''),coalesce(p_ativo,true),v_actor,v_actor)
  returning * into v_material;
  if p_quantidade_inicial > 0 then
    insert into public.movimentacoes_estoque(material_id,tipo,quantidade,motivo,quantidade_anterior,quantidade_posterior,created_by)
    values (v_material.id,'entrada',p_quantidade_inicial,'Estoque inicial',0,p_quantidade_inicial,v_actor);
  end if;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
  values(v_actor,'material_estoque_criado','materiais_estoque',v_material.id,jsonb_build_object('quantidade_inicial',p_quantidade_inicial));
  return v_material;
end;
$$;

create or replace function public.update_stock_material(
  p_material_id uuid, p_nome text, p_categoria text, p_unidade public.unidade_estoque,
  p_estoque_minimo integer, p_validade date default null, p_fornecedor text default null
)
returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.materiais_estoque%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao estoque negado.' using errcode = '42501'; end if;
  if coalesce(p_estoque_minimo, -1) < 0 or p_estoque_minimo > 1000000 then raise exception 'Estoque minimo invalido.' using errcode = '23514'; end if;
  update public.materiais_estoque set nome=btrim(coalesce(p_nome,'')),categoria=btrim(coalesce(p_categoria,'')),unidade=coalesce(p_unidade,'unidade'),estoque_minimo=p_estoque_minimo,validade=p_validade,fornecedor=nullif(btrim(p_fornecedor),''),updated_by=v_actor
  where id=p_material_id returning * into v_result;
  if not found then raise exception 'Material nao encontrado.' using errcode = 'P0002'; end if;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
  values(v_actor,'material_estoque_atualizado','materiais_estoque',v_result.id,jsonb_build_object('campos_alterados',jsonb_build_array('nome','categoria','unidade','estoque_minimo','validade','fornecedor')));
  return v_result;
end;
$$;

create or replace function public.set_stock_material_active(p_material_id uuid, p_ativo boolean)
returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.materiais_estoque%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso ao estoque negado.' using errcode = '42501'; end if;
  update public.materiais_estoque set ativo=p_ativo,updated_by=v_actor where id=p_material_id returning * into v_result;
  if not found then raise exception 'Material nao encontrado.' using errcode = 'P0002'; end if;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
  values(v_actor,case when p_ativo then 'material_estoque_ativado' else 'material_estoque_inativado' end,'materiais_estoque',v_result.id,'{}'::jsonb);
  return v_result;
end;
$$;

create or replace function public.register_stock_movement(
  p_material_id uuid, p_tipo public.tipo_movimentacao_estoque, p_quantidade integer,
  p_motivo text default null, p_referencia text default null
)
returns public.movimentacoes_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_material public.materiais_estoque%rowtype;
  v_after integer; v_motivo text := nullif(btrim(p_motivo), ''); v_result public.movimentacoes_estoque%rowtype;
  v_event text;
begin
  if not public.is_active_user() then raise exception 'Acesso ao estoque negado.' using errcode = '42501'; end if;
  if p_tipo = 'entrada' and not (public.is_admin() or public.is_active_reception()) then raise exception 'Entrada nao autorizada.' using errcode = '42501'; end if;
  if p_tipo = 'saida' and not public.can_operate_stock() then raise exception 'Saida nao autorizada.' using errcode = '42501'; end if;
  if p_tipo = 'ajuste' and not public.is_admin() then raise exception 'Ajuste nao autorizado.' using errcode = '42501'; end if;
  if p_tipo in ('entrada','saida') and (p_quantidade is null or p_quantidade <= 0 or p_quantidade > 1000000) then raise exception 'Quantidade invalida.' using errcode = '23514'; end if;
  if p_tipo = 'ajuste' and (p_quantidade is null or p_quantidade < 0 or p_quantidade > 1000000 or v_motivo is null) then raise exception 'Ajuste exige nova quantidade valida e motivo.' using errcode = '23514'; end if;
  if p_tipo = 'saida' and public.is_active_dentist() and v_motivo is null then raise exception 'Informe o motivo do consumo.' using errcode = '23514'; end if;
  select * into v_material from public.materiais_estoque where id=p_material_id for update;
  if not found then raise exception 'Material nao encontrado.' using errcode = 'P0002'; end if;
  if not v_material.ativo then raise exception 'Material inativo nao pode ser movimentado.' using errcode = '23514'; end if;
  v_after := case p_tipo when 'entrada' then v_material.quantidade_atual + p_quantidade when 'saida' then v_material.quantidade_atual - p_quantidade else p_quantidade end;
  if v_after < 0 then raise exception 'Estoque insuficiente para esta saida.' using errcode = '23514'; end if;
  update public.materiais_estoque set quantidade_atual=v_after,updated_by=v_actor where id=v_material.id;
  insert into public.movimentacoes_estoque(material_id,tipo,quantidade,motivo,referencia,quantidade_anterior,quantidade_posterior,created_by)
  values(v_material.id,p_tipo,p_quantidade,v_motivo,nullif(btrim(p_referencia),''),v_material.quantidade_atual,v_after,v_actor) returning * into v_result;
  v_event := case p_tipo when 'entrada' then 'estoque_entrada_registrada' when 'saida' then 'estoque_saida_registrada' else 'estoque_ajuste_registrado' end;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
  values(v_actor,v_event,'movimentacoes_estoque',v_result.id,jsonb_build_object('material_id',v_material.id,'quantidade_anterior',v_material.quantidade_atual,'quantidade_posterior',v_after));
  return v_result;
end;
$$;

create or replace function public.list_stock_materials(p_query text default null, p_categoria text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20)
returns table(id uuid,nome text,categoria text,unidade public.unidade_estoque,quantidade_atual integer,estoque_minimo integer,validade date,fornecedor text,ativo boolean,estoque_baixo boolean,vencendo boolean,vencido boolean,total_count bigint)
language plpgsql security definer set search_path = '' stable as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=least(greatest(coalesce(p_page_size,20),1),100); v_status text:=nullif(btrim(p_status),'');
begin
  if not public.is_active_user() then raise exception 'Acesso ao estoque negado.' using errcode='42501'; end if;
  if v_status is not null and v_status not in ('normal','estoque_baixo','vencendo','vencido','inativo') then raise exception 'Filtro invalido.' using errcode='22023'; end if;
  return query
  select material.id,material.nome,material.categoria,material.unidade,material.quantidade_atual,material.estoque_minimo,material.validade,material.fornecedor,material.ativo,
    (material.ativo and material.quantidade_atual <= material.estoque_minimo),
    (material.ativo and material.validade between current_date and current_date + 30),
    (material.ativo and material.validade < current_date), count(*) over()
  from public.materiais_estoque material
  where (p_query is null or btrim(p_query)='' or material.nome ilike ('%' || replace(replace(btrim(p_query),'%','\%'),'_','\_') || '%'))
    and (p_categoria is null or btrim(p_categoria)='' or material.categoria=p_categoria)
    and (v_status is null or (v_status='normal' and material.ativo and material.quantidade_atual > material.estoque_minimo and (material.validade is null or material.validade > current_date+30)) or (v_status='estoque_baixo' and material.ativo and material.quantidade_atual<=material.estoque_minimo) or (v_status='vencendo' and material.ativo and material.validade between current_date and current_date+30) or (v_status='vencido' and material.ativo and material.validade<current_date) or (v_status='inativo' and not material.ativo))
  order by material.ativo desc,material.nome,material.id offset (v_page-1)*v_size limit v_size;
end;
$$;

create or replace function public.get_stock_summary()
returns table(total_ativos bigint,estoque_baixo bigint,vencendo bigint,vencidos bigint)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not (public.is_admin() or public.is_active_reception()) then raise exception 'Resumo de estoque negado.' using errcode='42501'; end if;
  return query select count(*) filter(where material.ativo),count(*) filter(where material.ativo and material.quantidade_atual<=material.estoque_minimo),count(*) filter(where material.ativo and material.validade between current_date and current_date+30),count(*) filter(where material.ativo and material.validade<current_date) from public.materiais_estoque material;
end;
$$;

create or replace function public.list_stock_movements(p_material_id uuid default null,p_tipo public.tipo_movimentacao_estoque default null,p_inicio date default null,p_fim date default null,p_page integer default 1,p_page_size integer default 20)
returns table(id uuid,material_id uuid,material_nome text,tipo public.tipo_movimentacao_estoque,quantidade integer,motivo text,referencia text,quantidade_anterior integer,quantidade_posterior integer,created_at timestamptz,usuario_nome text,total_count bigint)
language plpgsql security definer set search_path = '' stable as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=least(greatest(coalesce(p_page_size,20),1),100); v_all boolean:=public.is_admin() or public.is_active_reception();
begin
  if not public.is_active_user() then raise exception 'Acesso ao estoque negado.' using errcode='42501'; end if;
  if not v_all and not public.is_active_dentist() then raise exception 'Acesso ao estoque negado.' using errcode='42501'; end if;
  return query select movimento.id,movimento.material_id,material.nome,movimento.tipo,movimento.quantidade,movimento.motivo,movimento.referencia,movimento.quantidade_anterior,movimento.quantidade_posterior,movimento.created_at,usuario.nome,count(*) over()
  from public.movimentacoes_estoque movimento join public.materiais_estoque material on material.id=movimento.material_id join public.usuarios usuario on usuario.id=movimento.created_by
  where (v_all or movimento.created_by=(select auth.uid())) and (p_material_id is null or movimento.material_id=p_material_id) and (p_tipo is null or movimento.tipo=p_tipo) and (p_inicio is null or movimento.created_at::date>=p_inicio) and (p_fim is null or movimento.created_at::date<=p_fim)
  order by movimento.created_at desc,movimento.id desc offset (v_page-1)*v_size limit v_size;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.auditoria'::regclass and conname = 'auditoria_evento_check'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.auditoria'::regclass and conname = 'auditoria_evento_check'
      and pg_get_constraintdef(oid) like '%material_estoque_criado%'
  ) then
    alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in ('usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada','paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados','agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido','atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada','documento_criado','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado','pagamento_criado','pagamento_cancelado','pagamento_estornado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado'));

  end if;
end $$;

revoke execute on function public.can_operate_stock(), public.create_stock_material(text,text,public.unidade_estoque,integer,integer,date,text,boolean), public.update_stock_material(uuid,text,text,public.unidade_estoque,integer,date,text), public.set_stock_material_active(uuid,boolean), public.register_stock_movement(uuid,public.tipo_movimentacao_estoque,integer,text,text), public.list_stock_materials(text,text,text,integer,integer), public.get_stock_summary(), public.list_stock_movements(uuid,public.tipo_movimentacao_estoque,date,date,integer,integer) from public, anon;
grant execute on function public.can_operate_stock(), public.create_stock_material(text,text,public.unidade_estoque,integer,integer,date,text,boolean), public.update_stock_material(uuid,text,text,public.unidade_estoque,integer,date,text), public.set_stock_material_active(uuid,boolean), public.register_stock_movement(uuid,public.tipo_movimentacao_estoque,integer,text,text), public.list_stock_materials(text,text,text,integer,integer), public.get_stock_summary(), public.list_stock_movements(uuid,public.tipo_movimentacao_estoque,date,date,integer,integer) to authenticated;
commit;
