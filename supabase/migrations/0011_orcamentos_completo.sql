-- Sprint 10: orcamentos. Aditiva e autonoma; nao reutiliza o WIP 0007/0008.
begin;

do $$ begin
  create type public.status_orcamento as enum ('rascunho','enviado','aprovado','rejeitado','expirado','convertido');
exception when duplicate_object then null;
end $$;
alter type public.status_orcamento add value if not exists 'rejeitado';
alter type public.status_orcamento add value if not exists 'expirado';
alter type public.status_orcamento add value if not exists 'convertido';

create sequence if not exists public.orcamentos_numero_seq;

create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('public.orcamentos_numero_seq'::regclass),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  profissional_id uuid not null references public.profissionais(id) on delete restrict,
  data_orcamento date not null default current_date,
  validade_em date,
  observacao_administrativa text,
  status public.status_orcamento not null default 'rascunho',
  total_centavos integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint orcamentos_numero_unico unique (numero),
  constraint orcamentos_total_valido check (total_centavos >= 0),
  constraint orcamentos_validade_valida check (validade_em is null or validade_em >= data_orcamento),
  constraint orcamentos_observacao_valida check (observacao_administrativa is null or (observacao_administrativa = btrim(observacao_administrativa) and char_length(observacao_administrativa) between 1 and 1000))
);

alter table public.orcamentos add column if not exists numero bigint;
alter table public.orcamentos add column if not exists validade_em date;
update public.orcamentos set numero = nextval('public.orcamentos_numero_seq'::regclass) where numero is null;
alter table public.orcamentos alter column numero set not null;
alter table public.orcamentos alter column numero set default nextval('public.orcamentos_numero_seq'::regclass);
create unique index if not exists orcamentos_numero_unico_idx on public.orcamentos(numero);
select setval(
  'public.orcamentos_numero_seq',
  coalesce((select max(numero) from public.orcamentos), 1),
  exists(select 1 from public.orcamentos)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orcamentos_total_valido') then
    alter table public.orcamentos add constraint orcamentos_total_valido check (total_centavos >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orcamentos_validade_valida') then
    alter table public.orcamentos add constraint orcamentos_validade_valida check (validade_em is null or validade_em >= data_orcamento);
  end if;
end $$;

create table if not exists public.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos(id) on delete restrict,
  descricao text not null,
  quantidade integer not null default 1,
  valor_unitario_centavos integer not null,
  total_centavos bigint generated always as (quantidade * valor_unitario_centavos) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint orcamento_itens_descricao_valida check (descricao = btrim(descricao) and char_length(descricao) between 2 and 300),
  constraint orcamento_itens_quantidade_valida check (quantidade between 1 and 999),
  constraint orcamento_itens_valor_valido check (valor_unitario_centavos >= 0)
);
alter table public.orcamento_itens add column if not exists ativo boolean not null default true;
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orcamento_itens' and column_name = 'status_ativo'
  ) then
    execute 'update public.orcamento_itens set ativo = status_ativo where ativo and status_ativo is not null';
  end if;
end $$;

create index if not exists orcamentos_paciente_data_idx on public.orcamentos(paciente_id, data_orcamento desc, id);
create index if not exists orcamentos_profissional_status_idx on public.orcamentos(profissional_id, status, data_orcamento desc, id);
create index if not exists orcamento_itens_ativos_idx on public.orcamento_itens(orcamento_id, ativo, id);

drop trigger if exists orcamentos_set_updated_at on public.orcamentos;
create trigger orcamentos_set_updated_at before update on public.orcamentos for each row execute function public.set_updated_at();
drop trigger if exists orcamento_itens_set_updated_at on public.orcamento_itens;
create trigger orcamento_itens_set_updated_at before update on public.orcamento_itens for each row execute function public.set_updated_at();

create or replace function public.can_manage_budgets()
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_admin() or public.is_active_reception();
$$;
create or replace function public.can_access_own_budget(p_orcamento_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_active_dentist() and exists (
    select 1 from public.orcamentos o
    where o.id = p_orcamento_id and o.profissional_id = public.current_professional_id()
  );
$$;

alter table public.orcamentos enable row level security;
alter table public.orcamento_itens enable row level security;
drop policy if exists orcamentos_select on public.orcamentos;
create policy orcamentos_select on public.orcamentos for select to authenticated using (
  public.is_active_user() and (public.can_manage_budgets() or (public.is_active_dentist() and profissional_id = public.current_professional_id()))
);
drop policy if exists orcamento_itens_select on public.orcamento_itens;
create policy orcamento_itens_select on public.orcamento_itens for select to authenticated using (
  public.is_active_user() and (public.can_manage_budgets() or public.can_access_own_budget(orcamento_id))
);
revoke insert, update, delete on public.orcamentos, public.orcamento_itens from anon, authenticated;
grant select on public.orcamentos, public.orcamento_itens to authenticated;
grant all on public.orcamentos, public.orcamento_itens to service_role;

create or replace function public.refresh_budget_total(p_orcamento_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.orcamentos set total_centavos = coalesce((select sum(total_centavos) from public.orcamento_itens where orcamento_id = p_orcamento_id and ativo), 0) where id = p_orcamento_id;
end; $$;

-- A WIP antiga usava esta mesma assinatura, mas com `p_data_orcamento`.
-- Removemos somente a funcao substituida para que a migration permaneça
-- aplicavel em homologacoes que tenham recebido 0007/0008 no passado.
drop function if exists public.create_budget(uuid, uuid, date, text);
create or replace function public.create_budget(p_paciente_id uuid, p_profissional_id uuid, p_validade_em date default null, p_observacao_administrativa text default null)
returns public.orcamentos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result public.orcamentos%rowtype; v_prof uuid := public.current_professional_id();
begin
  if not public.is_active_user() then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if not public.can_manage_budgets() and (v_prof is null or p_profissional_id is distinct from v_prof) then raise exception 'Profissional nao autorizado.' using errcode='42501'; end if;
  if not exists(select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514'; end if;
  if not exists(select 1 from public.profissionais p join public.usuarios u on u.id=p.usuario_id where p.id=p_profissional_id and p.status='ativo' and u.status='ativo' and u.perfil='dentista') then raise exception 'Profissional invalido.' using errcode='23514'; end if;
  insert into public.orcamentos(paciente_id,profissional_id,validade_em,observacao_administrativa,created_by,updated_by) values(p_paciente_id,p_profissional_id,p_validade_em,nullif(btrim(p_observacao_administrativa),''),v_actor,v_actor) returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_criado','orcamentos',v_result.id,jsonb_build_object('paciente_id',v_result.paciente_id,'profissional_id',v_result.profissional_id));
  return v_result;
end; $$;

create or replace function public.update_budget(p_orcamento_id uuid,p_paciente_id uuid,p_profissional_id uuid,p_validade_em date,p_observacao_administrativa text default null)
returns public.orcamentos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_before public.orcamentos%rowtype; v_result public.orcamentos%rowtype;
begin
  select * into v_before from public.orcamentos where id=p_orcamento_id for update;
  if not found then raise exception 'Orcamento nao encontrado.' using errcode='P0002'; end if;
  if not public.can_manage_budgets() and not public.can_access_own_budget(p_orcamento_id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if v_before.status <> 'rascunho' then raise exception 'Somente rascunhos podem ser editados.' using errcode='23514'; end if;
  if not exists(select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514'; end if;
  if not exists(select 1 from public.profissionais p join public.usuarios u on u.id=p.usuario_id where p.id=p_profissional_id and p.status='ativo' and u.status='ativo' and u.perfil='dentista') then raise exception 'Profissional invalido.' using errcode='23514'; end if;
  update public.orcamentos set paciente_id=p_paciente_id,profissional_id=p_profissional_id,validade_em=p_validade_em,observacao_administrativa=nullif(btrim(p_observacao_administrativa),''),updated_by=v_actor where id=p_orcamento_id returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_atualizado','orcamentos',v_result.id,jsonb_build_object('campos_alterados',jsonb_build_array('paciente_id','profissional_id','validade_em','observacao_administrativa')));
  return v_result;
end; $$;

create or replace function public.add_budget_item(p_orcamento_id uuid,p_descricao text,p_quantidade integer,p_valor_unitario_centavos integer)
returns public.orcamento_itens language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_budget public.orcamentos%rowtype; v_item public.orcamento_itens%rowtype;
begin
  select * into v_budget from public.orcamentos where id=p_orcamento_id for update;
  if not found then raise exception 'Orcamento nao encontrado.' using errcode='P0002'; end if;
  if not public.can_manage_budgets() and not public.can_access_own_budget(p_orcamento_id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if v_budget.status <> 'rascunho' then raise exception 'Somente rascunhos aceitam itens.' using errcode='23514'; end if;
  insert into public.orcamento_itens(orcamento_id,descricao,quantidade,valor_unitario_centavos,created_by,updated_by) values(p_orcamento_id,btrim(coalesce(p_descricao,'')),p_quantidade,p_valor_unitario_centavos,v_actor,v_actor) returning * into v_item;
  perform public.refresh_budget_total(p_orcamento_id);
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_item_criado','orcamento_itens',v_item.id,jsonb_build_object('orcamento_id',p_orcamento_id)); return v_item;
end; $$;

create or replace function public.update_budget_item(p_item_id uuid,p_descricao text,p_quantidade integer,p_valor_unitario_centavos integer)
returns public.orcamento_itens language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_item public.orcamento_itens%rowtype; v_budget public.orcamentos%rowtype;
begin
  select * into v_item from public.orcamento_itens where id=p_item_id for update; if not found or not v_item.ativo then raise exception 'Item nao encontrado.' using errcode='P0002'; end if;
  select * into v_budget from public.orcamentos where id=v_item.orcamento_id for update;
  if not public.can_manage_budgets() and not public.can_access_own_budget(v_budget.id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if v_budget.status <> 'rascunho' then raise exception 'Somente rascunhos podem ser editados.' using errcode='23514'; end if;
  update public.orcamento_itens set descricao=btrim(coalesce(p_descricao,'')),quantidade=p_quantidade,valor_unitario_centavos=p_valor_unitario_centavos,updated_by=v_actor where id=v_item.id returning * into v_item;
  perform public.refresh_budget_total(v_budget.id); insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_item_atualizado','orcamento_itens',v_item.id,jsonb_build_object('orcamento_id',v_budget.id,'campos_alterados',jsonb_build_array('descricao','quantidade','valor_unitario_centavos'))); return v_item;
end; $$;

create or replace function public.remove_budget_item(p_item_id uuid)
returns public.orcamento_itens language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_item public.orcamento_itens%rowtype; v_budget public.orcamentos%rowtype;
begin
  select * into v_item from public.orcamento_itens where id=p_item_id for update; if not found or not v_item.ativo then raise exception 'Item nao encontrado.' using errcode='P0002'; end if;
  select * into v_budget from public.orcamentos where id=v_item.orcamento_id for update;
  if not public.can_manage_budgets() and not public.can_access_own_budget(v_budget.id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if v_budget.status <> 'rascunho' then raise exception 'Somente rascunhos podem ser editados.' using errcode='23514'; end if;
  update public.orcamento_itens set ativo=false,updated_by=v_actor where id=v_item.id returning * into v_item; perform public.refresh_budget_total(v_budget.id);
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_item_removido','orcamento_itens',v_item.id,jsonb_build_object('orcamento_id',v_budget.id)); return v_item;
end; $$;

create or replace function public.set_budget_status(p_orcamento_id uuid,p_status public.status_orcamento)
returns public.orcamentos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_before public.orcamentos%rowtype; v_result public.orcamentos%rowtype;
begin
  select * into v_before from public.orcamentos where id=p_orcamento_id for update; if not found then raise exception 'Orcamento nao encontrado.' using errcode='P0002'; end if;
  if not public.can_manage_budgets() and not public.can_access_own_budget(p_orcamento_id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if v_before.status='enviado' and v_before.validade_em < current_date then
    update public.orcamentos set status='expirado',updated_by=v_actor where id=v_before.id returning * into v_before;
    insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
      values(v_actor,'orcamento_status_alterado','orcamentos',v_before.id,jsonb_build_object('status_anterior','enviado','status_novo','expirado'));
  end if;
  if (v_before.status='rascunho' and p_status='enviado' and v_before.validade_em is not null and exists(select 1 from public.orcamento_itens where orcamento_id=v_before.id and ativo) and v_before.total_centavos>0)
     or (v_before.status='enviado' and p_status in ('aprovado','rejeitado'))
     or (v_before.status='aprovado' and p_status='convertido') then null; else raise exception 'Transicao de status invalida.' using errcode='23514'; end if;
  if p_status='enviado' and v_before.validade_em < current_date then raise exception 'Validade expirada.' using errcode='23514'; end if;
  if p_status='aprovado' and (v_before.validade_em is null or v_before.validade_em < current_date) then raise exception 'Orcamento expirado.' using errcode='23514'; end if;
  update public.orcamentos set status=p_status,updated_by=v_actor where id=v_before.id returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_status_alterado','orcamentos',v_result.id,jsonb_build_object('status_anterior',v_before.status,'status_novo',v_result.status)); return v_result;
end; $$;

-- O PDF e entregue diretamente pela rota autenticada; esta RPC existe apenas
-- para registrar a emissao sem ampliar privilegios no cliente nem guardar URL.
create or replace function public.register_budget_pdf_generation(p_orcamento_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if not public.is_active_user()
     or (not public.can_manage_budgets() and not public.can_access_own_budget(p_orcamento_id)) then
    raise exception 'Acesso negado.' using errcode='42501';
  end if;
  if not exists(select 1 from public.orcamentos where id = p_orcamento_id) then
    raise exception 'Orcamento nao encontrado.' using errcode='P0002';
  end if;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
    values(v_actor,'orcamento_pdf_gerado','orcamentos',p_orcamento_id,'{}'::jsonb);
end; $$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in ('usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada','paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados','agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido','atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada','documento_criado','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado'));

revoke execute on function public.can_manage_budgets(),public.can_access_own_budget(uuid),public.refresh_budget_total(uuid),public.create_budget(uuid,uuid,date,text),public.update_budget(uuid,uuid,uuid,date,text),public.add_budget_item(uuid,text,integer,integer),public.update_budget_item(uuid,text,integer,integer),public.remove_budget_item(uuid),public.set_budget_status(uuid,public.status_orcamento),public.register_budget_pdf_generation(uuid) from public, anon;
grant execute on function public.can_manage_budgets(),public.can_access_own_budget(uuid),public.create_budget(uuid,uuid,date,text),public.update_budget(uuid,uuid,uuid,date,text),public.add_budget_item(uuid,text,integer,integer),public.update_budget_item(uuid,text,integer,integer),public.remove_budget_item(uuid),public.set_budget_status(uuid,public.status_orcamento),public.register_budget_pdf_generation(uuid) to authenticated;
commit;
