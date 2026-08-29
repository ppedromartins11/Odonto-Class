begin;

create type public.forma_pagamento as enum ('dinheiro','pix','cartao','transferencia','outro');
create type public.status_pagamento as enum ('pendente','pago','cancelado');
create type public.status_orcamento as enum ('rascunho','enviado','aprovado','recusado','cancelado');
create type public.categoria_validade as enum ('material','esterilizacao');
create type public.status_validade_operacional as enum ('ativo','utilizado','descartado');

create table public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  profissional_id uuid references public.profissionais(id) on delete restrict,
  data_orcamento date not null default current_date,
  status public.status_orcamento not null default 'rascunho',
  observacao_administrativa text,
  total_centavos integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint orcamentos_total_valido check (total_centavos >= 0),
  constraint orcamentos_observacao_valida check (observacao_administrativa is null or (observacao_administrativa=btrim(observacao_administrativa) and char_length(observacao_administrativa) between 1 and 1000))
);

create table public.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos(id) on delete restrict,
  descricao text not null,
  quantidade integer not null default 1,
  valor_unitario_centavos integer not null,
  total_centavos integer generated always as (quantidade * valor_unitario_centavos) stored,
  status_ativo boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint orcamento_itens_descricao_valida check (descricao=btrim(descricao) and char_length(descricao) between 2 and 300),
  constraint orcamento_itens_quantidade_valida check (quantidade between 1 and 999),
  constraint orcamento_itens_valor_valido check (valor_unitario_centavos > 0)
);

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  atendimento_id uuid references public.atendimentos(id) on delete restrict,
  orcamento_id uuid references public.orcamentos(id) on delete restrict,
  profissional_id uuid references public.profissionais(id) on delete restrict,
  data_pagamento date not null default current_date,
  valor_centavos integer not null,
  forma public.forma_pagamento not null,
  status public.status_pagamento not null default 'pendente',
  observacao_administrativa text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint pagamentos_valor_valido check (valor_centavos > 0),
  constraint pagamentos_um_vinculo check (num_nonnulls(atendimento_id,orcamento_id) <= 1),
  constraint pagamentos_observacao_valida check (observacao_administrativa is null or (observacao_administrativa=btrim(observacao_administrativa) and char_length(observacao_administrativa) between 1 and 1000))
);

create table public.controle_validade (
  id uuid primary key default gen_random_uuid(),
  categoria public.categoria_validade not null,
  descricao text not null,
  data_validade date not null,
  lote_codigo text,
  responsavel_id uuid not null references public.usuarios(id) on delete restrict,
  status_operacional public.status_validade_operacional not null default 'ativo',
  observacao_administrativa text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint controle_validade_descricao_valida check (descricao=btrim(descricao) and char_length(descricao) between 2 and 300),
  constraint controle_validade_lote_valido check (lote_codigo is null or (lote_codigo=btrim(lote_codigo) and char_length(lote_codigo) between 1 and 100)),
  constraint controle_validade_observacao_valida check (observacao_administrativa is null or (observacao_administrativa=btrim(observacao_administrativa) and char_length(observacao_administrativa) between 1 and 1000))
);

create index orcamentos_paciente_idx on public.orcamentos(paciente_id,data_orcamento desc,id);
create index orcamentos_profissional_idx on public.orcamentos(profissional_id,status,data_orcamento desc,id);
create index orcamento_itens_orcamento_idx on public.orcamento_itens(orcamento_id,status_ativo,id);
create index pagamentos_paciente_idx on public.pagamentos(paciente_id,data_pagamento desc,id);
create index pagamentos_status_data_idx on public.pagamentos(status,data_pagamento desc,id);
create index pagamentos_atendimento_idx on public.pagamentos(atendimento_id) where atendimento_id is not null;
create index controle_validade_status_data_idx on public.controle_validade(status_operacional,data_validade,id);

create trigger orcamentos_set_updated_at before update on public.orcamentos for each row execute function public.set_updated_at();
create trigger orcamento_itens_set_updated_at before update on public.orcamento_itens for each row execute function public.set_updated_at();
create trigger pagamentos_set_updated_at before update on public.pagamentos for each row execute function public.set_updated_at();
create trigger controle_validade_set_updated_at before update on public.controle_validade for each row execute function public.set_updated_at();

create function public.can_manage_financial() returns boolean language sql security definer set search_path='' stable as $$
  select public.is_active_user() and exists(select 1 from public.usuarios u where u.id=auth.uid() and u.perfil in ('administrador','recepcao'));
$$;

create function public.can_access_own_budget(p_orcamento_id uuid) returns boolean language sql security definer set search_path='' stable as $$
  select public.is_active_dentist() and exists(select 1 from public.orcamentos o where o.id=p_orcamento_id and o.profissional_id=public.current_professional_id());
$$;

alter table public.orcamentos enable row level security;
alter table public.orcamento_itens enable row level security;
alter table public.pagamentos enable row level security;
alter table public.controle_validade enable row level security;

create policy orcamentos_select on public.orcamentos for select to authenticated using (public.is_active_user() and (public.can_manage_financial() or (public.is_active_dentist() and profissional_id=public.current_professional_id())));
create policy orcamento_itens_select on public.orcamento_itens for select to authenticated using (public.is_active_user() and (public.can_manage_financial() or public.can_access_own_budget(orcamento_id)));
create policy pagamentos_select on public.pagamentos for select to authenticated using (public.is_active_user() and (public.can_manage_financial() or (public.is_active_dentist() and atendimento_id is not null and exists(select 1 from public.atendimentos a where a.id=atendimento_id and a.profissional_id=public.current_professional_id()))));
create policy controle_validade_select on public.controle_validade for select to authenticated using (public.can_manage_financial());
revoke insert,update,delete on public.orcamentos,public.orcamento_itens,public.pagamentos,public.controle_validade from anon,authenticated;
grant select on public.orcamentos,public.orcamento_itens,public.pagamentos,public.controle_validade to authenticated;
grant all on public.orcamentos,public.orcamento_itens,public.pagamentos,public.controle_validade to service_role;

create function public.refresh_budget_total(p_orcamento_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin update public.orcamentos set total_centavos=coalesce((select sum(i.total_centavos) from public.orcamento_itens i where i.orcamento_id=p_orcamento_id and i.status_ativo),0) where id=p_orcamento_id; end; $$;
create function public.assert_payment_links(p_paciente_id uuid,p_atendimento_id uuid,p_orcamento_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin if not exists(select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514'; end if; if p_atendimento_id is not null and not exists(select 1 from public.atendimentos where id=p_atendimento_id and paciente_id=p_paciente_id) then raise exception 'Atendimento invalido.' using errcode='23514'; end if; if p_orcamento_id is not null and not exists(select 1 from public.orcamentos where id=p_orcamento_id and paciente_id=p_paciente_id) then raise exception 'Orcamento invalido.' using errcode='23514'; end if; end; $$;

create function public.create_payment(p_paciente_id uuid,p_atendimento_id uuid,p_orcamento_id uuid,p_profissional_id uuid,p_data_pagamento date,p_valor_centavos integer,p_forma public.forma_pagamento,p_status public.status_pagamento,p_observacao_administrativa text default null) returns public.pagamentos language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_result public.pagamentos%rowtype; begin if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode='42501'; end if; if p_valor_centavos is null or p_valor_centavos<=0 then raise exception 'Valor invalido.' using errcode='23514'; end if; if num_nonnulls(p_atendimento_id,p_orcamento_id)>1 then raise exception 'Vinculos conflitantes.' using errcode='23514'; end if; perform public.assert_payment_links(p_paciente_id,p_atendimento_id,p_orcamento_id); insert into public.pagamentos(paciente_id,atendimento_id,orcamento_id,profissional_id,data_pagamento,valor_centavos,forma,status,observacao_administrativa,created_by,updated_by) values(p_paciente_id,p_atendimento_id,p_orcamento_id,p_profissional_id,coalesce(p_data_pagamento,current_date),p_valor_centavos,p_forma,coalesce(p_status,'pendente'),nullif(btrim(p_observacao_administrativa),''),v_actor,v_actor) returning * into v_result; insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'pagamento_criado','pagamentos',v_result.id,jsonb_build_object('paciente_id',v_result.paciente_id,'status',v_result.status,'forma',v_result.forma)); return v_result; end; $$;
create function public.update_payment(p_pagamento_id uuid,p_data_pagamento date,p_valor_centavos integer,p_forma public.forma_pagamento,p_status public.status_pagamento,p_observacao_administrativa text default null) returns public.pagamentos language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_before public.pagamentos%rowtype;v_result public.pagamentos%rowtype;begin if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode='42501';end if;select * into v_before from public.pagamentos where id=p_pagamento_id for update;if not found or v_before.status='cancelado' then raise exception 'Pagamento inacessivel.' using errcode='23514';end if;if p_valor_centavos is null or p_valor_centavos<=0 then raise exception 'Valor invalido.' using errcode='23514';end if;update public.pagamentos set data_pagamento=coalesce(p_data_pagamento,data_pagamento),valor_centavos=p_valor_centavos,forma=p_forma,status=coalesce(p_status,status),observacao_administrativa=nullif(btrim(p_observacao_administrativa),''),updated_by=v_actor where id=v_before.id returning * into v_result;insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'pagamento_atualizado','pagamentos',v_result.id,jsonb_build_object('campos_alterados',jsonb_build_array('data_pagamento','valor_centavos','forma','status','observacao_administrativa')));return v_result;end; $$;
create function public.cancel_payment(p_pagamento_id uuid) returns public.pagamentos language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_result public.pagamentos%rowtype;begin if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode='42501';end if;update public.pagamentos set status='cancelado',updated_by=v_actor where id=p_pagamento_id and status<>'cancelado' returning * into v_result;if not found then raise exception 'Pagamento inacessivel.' using errcode='23514';end if;insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'pagamento_cancelado','pagamentos',v_result.id,jsonb_build_object('status','cancelado'));return v_result;end; $$;

create function public.create_budget(p_paciente_id uuid,p_profissional_id uuid,p_data_orcamento date,p_observacao_administrativa text default null) returns public.orcamentos language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_prof uuid:=public.current_professional_id();v_result public.orcamentos%rowtype;begin if not public.is_active_user() then raise exception 'Usuario inativo.' using errcode='42501';end if;if not public.can_manage_financial() and (v_prof is null or p_profissional_id is distinct from v_prof) then raise exception 'Profissional nao autorizado.' using errcode='42501';end if;if not exists(select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514';end if;if p_profissional_id is not null and not exists(select 1 from public.profissionais where id=p_profissional_id and status='ativo') then raise exception 'Profissional invalido.' using errcode='23514';end if;insert into public.orcamentos(paciente_id,profissional_id,data_orcamento,observacao_administrativa,created_by,updated_by) values(p_paciente_id,p_profissional_id,coalesce(p_data_orcamento,current_date),nullif(btrim(p_observacao_administrativa),''),v_actor,v_actor) returning * into v_result;insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_criado','orcamentos',v_result.id,jsonb_build_object('paciente_id',v_result.paciente_id,'profissional_id',v_result.profissional_id));return v_result;end; $$;
create function public.add_budget_item(p_orcamento_id uuid,p_descricao text,p_quantidade integer,p_valor_unitario_centavos integer) returns public.orcamento_itens language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_item public.orcamento_itens%rowtype;begin if not public.can_manage_financial() and not public.can_access_own_budget(p_orcamento_id) then raise exception 'Acesso ao orcamento negado.' using errcode='42501';end if;if exists(select 1 from public.orcamentos where id=p_orcamento_id and status not in ('rascunho','enviado')) then raise exception 'Orcamento encerrado.' using errcode='23514';end if;insert into public.orcamento_itens(orcamento_id,descricao,quantidade,valor_unitario_centavos,created_by,updated_by) values(p_orcamento_id,btrim(p_descricao),coalesce(p_quantidade,1),p_valor_unitario_centavos,v_actor,v_actor) returning * into v_item;perform public.refresh_budget_total(p_orcamento_id);insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_item_criado','orcamento_itens',v_item.id,jsonb_build_object('orcamento_id',p_orcamento_id));return v_item;end; $$;
create function public.update_budget_status(p_orcamento_id uuid,p_status public.status_orcamento) returns public.orcamentos language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_result public.orcamentos%rowtype;begin if not public.can_manage_financial() and not public.can_access_own_budget(p_orcamento_id) then raise exception 'Acesso ao orcamento negado.' using errcode='42501';end if;update public.orcamentos set status=p_status,updated_by=v_actor where id=p_orcamento_id and status not in ('recusado','cancelado') returning * into v_result;if not found then raise exception 'Orcamento inacessivel.' using errcode='23514';end if;insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'orcamento_status_alterado','orcamentos',v_result.id,jsonb_build_object('status',v_result.status));return v_result;end; $$;

create function public.create_validity_item(p_categoria public.categoria_validade,p_descricao text,p_data_validade date,p_lote_codigo text,p_responsavel_id uuid,p_observacao_administrativa text default null) returns public.controle_validade language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_result public.controle_validade%rowtype;begin if not public.can_manage_financial() then raise exception 'Acesso operacional negado.' using errcode='42501';end if;if not exists(select 1 from public.usuarios where id=p_responsavel_id and status='ativo') then raise exception 'Responsavel invalido.' using errcode='23514';end if;insert into public.controle_validade(categoria,descricao,data_validade,lote_codigo,responsavel_id,observacao_administrativa,created_by,updated_by) values(p_categoria,btrim(p_descricao),p_data_validade,nullif(btrim(p_lote_codigo),''),p_responsavel_id,nullif(btrim(p_observacao_administrativa),''),v_actor,v_actor) returning * into v_result;insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'validade_item_criado','controle_validade',v_result.id,jsonb_build_object('categoria',v_result.categoria,'data_validade',v_result.data_validade));return v_result;end; $$;
create function public.set_validity_status(p_item_id uuid,p_status public.status_validade_operacional) returns public.controle_validade language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid();v_result public.controle_validade%rowtype;v_event text;begin if not public.can_manage_financial() then raise exception 'Acesso operacional negado.' using errcode='42501';end if;update public.controle_validade set status_operacional=p_status,updated_by=v_actor where id=p_item_id and status_operacional='ativo' returning * into v_result;if not found then raise exception 'Item inacessivel.' using errcode='23514';end if;v_event:=case when p_status='utilizado' then 'validade_item_utilizado' else 'validade_item_descartado' end;insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,v_event,'controle_validade',v_result.id,jsonb_build_object('status_operacional',v_result.status_operacional));return v_result;end; $$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in ('usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada','paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados','agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido','atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada','documento_criado','arquivo_enviado','arquivo_removido','pagamento_criado','pagamento_atualizado','pagamento_cancelado','orcamento_criado','orcamento_item_criado','orcamento_status_alterado','validade_item_criado','validade_item_utilizado','validade_item_descartado'));

revoke execute on function public.can_manage_financial(),public.can_access_own_budget(uuid),public.refresh_budget_total(uuid),public.assert_payment_links(uuid,uuid,uuid),public.create_payment(uuid,uuid,uuid,uuid,date,integer,public.forma_pagamento,public.status_pagamento,text),public.update_payment(uuid,date,integer,public.forma_pagamento,public.status_pagamento,text),public.cancel_payment(uuid),public.create_budget(uuid,uuid,date,text),public.add_budget_item(uuid,text,integer,integer),public.update_budget_status(uuid,public.status_orcamento),public.create_validity_item(public.categoria_validade,text,date,text,uuid,text),public.set_validity_status(uuid,public.status_validade_operacional) from public,anon;
grant execute on function public.can_manage_financial(),public.can_access_own_budget(uuid),public.create_payment(uuid,uuid,uuid,uuid,date,integer,public.forma_pagamento,public.status_pagamento,text),public.update_payment(uuid,date,integer,public.forma_pagamento,public.status_pagamento,text),public.cancel_payment(uuid),public.create_budget(uuid,uuid,date,text),public.add_budget_item(uuid,text,integer,integer),public.update_budget_status(uuid,public.status_orcamento),public.create_validity_item(public.categoria_validade,text,date,text,uuid,text),public.set_validity_status(uuid,public.status_validade_operacional) to authenticated;
commit;
