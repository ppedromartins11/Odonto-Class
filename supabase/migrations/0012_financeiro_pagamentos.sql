-- Sprint 11: pagamentos operacionais. Aditiva; migrations anteriores imutaveis.
begin;

do $$ begin
  create type public.forma_pagamento as enum ('pix','dinheiro','cartao_credito','cartao_debito','transferencia','outro');
exception when duplicate_object then null;
end $$;
alter type public.forma_pagamento add value if not exists 'cartao_credito';
alter type public.forma_pagamento add value if not exists 'cartao_debito';

do $$ begin
  create type public.status_pagamento as enum ('pago','estornado','cancelado');
exception when duplicate_object then null;
end $$;
alter type public.status_pagamento add value if not exists 'estornado';

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  atendimento_id uuid references public.atendimentos(id) on delete restrict,
  orcamento_id uuid references public.orcamentos(id) on delete restrict,
  valor_centavos integer not null,
  forma public.forma_pagamento not null,
  status public.status_pagamento not null default 'pago',
  data_pagamento date not null default current_date,
  observacao_administrativa text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint pagamentos_valor_valido check (valor_centavos > 0),
  constraint pagamentos_um_vinculo check (num_nonnulls(atendimento_id, orcamento_id) <= 1),
  constraint pagamentos_observacao_valida check (observacao_administrativa is null or (observacao_administrativa = btrim(observacao_administrativa) and char_length(observacao_administrativa) between 1 and 1000))
);

-- Compatibilidade apenas para homologacoes ficticias que receberam o WIP 0007/0008.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='pagamentos' and column_name='forma') then
    execute 'update public.pagamentos set forma = ''cartao_credito''::public.forma_pagamento where forma::text = ''cartao''';
  end if;
end $$;

create index if not exists pagamentos_paciente_data_idx on public.pagamentos(paciente_id, data_pagamento desc, id);
create index if not exists pagamentos_data_status_idx on public.pagamentos(data_pagamento desc, status, id);
create unique index if not exists pagamentos_atendimento_pago_unico_idx on public.pagamentos(atendimento_id) where atendimento_id is not null and status = 'pago';
create unique index if not exists pagamentos_orcamento_pago_unico_idx on public.pagamentos(orcamento_id) where orcamento_id is not null and status = 'pago';

drop trigger if exists pagamentos_set_updated_at on public.pagamentos;
create trigger pagamentos_set_updated_at before update on public.pagamentos for each row execute function public.set_updated_at();

create or replace function public.can_manage_financial()
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_admin() or public.is_active_reception();
$$;

create or replace function public.can_access_own_payment(p_pagamento_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_active_dentist() and exists (
    select 1 from public.pagamentos pagamento
    join public.atendimentos atendimento on atendimento.id = pagamento.atendimento_id
    where pagamento.id = p_pagamento_id
      and atendimento.profissional_id = public.current_professional_id()
  );
$$;

alter table public.pagamentos enable row level security;
drop policy if exists pagamentos_select on public.pagamentos;
create policy pagamentos_select on public.pagamentos for select to authenticated using (
  public.is_active_user() and (public.can_manage_financial() or public.can_access_own_payment(id))
);
revoke insert, update, delete on public.pagamentos from anon, authenticated;
grant select on public.pagamentos to authenticated;
grant all on public.pagamentos to service_role;

create or replace function public.create_payment(
  p_paciente_id uuid,
  p_atendimento_id uuid,
  p_orcamento_id uuid,
  p_valor_centavos integer,
  p_forma public.forma_pagamento,
  p_data_pagamento date,
  p_observacao_administrativa text default null
)
returns public.pagamentos language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_attendance public.atendimentos%rowtype;
  v_budget public.orcamentos%rowtype;
  v_result public.pagamentos%rowtype;
begin
  if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode='42501'; end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 then raise exception 'Valor invalido.' using errcode='23514'; end if;
  if num_nonnulls(p_atendimento_id, p_orcamento_id) > 1 then raise exception 'Vinculos conflitantes.' using errcode='23514'; end if;
  if not exists (select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514'; end if;
  if p_atendimento_id is not null then
    select * into v_attendance from public.atendimentos where id=p_atendimento_id for key share;
    if not found or v_attendance.paciente_id <> p_paciente_id then raise exception 'Atendimento invalido para o paciente.' using errcode='23514'; end if;
  end if;
  if p_orcamento_id is not null then
    select * into v_budget from public.orcamentos where id=p_orcamento_id for key share;
    if not found or v_budget.paciente_id <> p_paciente_id or v_budget.status <> 'aprovado' then raise exception 'Orcamento invalido para pagamento.' using errcode='23514'; end if;
  end if;
  insert into public.pagamentos(paciente_id,atendimento_id,orcamento_id,valor_centavos,forma,status,data_pagamento,observacao_administrativa,created_by,updated_by)
  values(p_paciente_id,p_atendimento_id,p_orcamento_id,p_valor_centavos,p_forma,'pago',coalesce(p_data_pagamento,current_date),nullif(btrim(p_observacao_administrativa),''),v_actor,v_actor)
  returning * into v_result;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
    values(v_actor,'pagamento_criado','pagamentos',v_result.id,jsonb_build_object('paciente_id',v_result.paciente_id,'atendimento_id',v_result.atendimento_id,'orcamento_id',v_result.orcamento_id,'forma',v_result.forma,'status',v_result.status));
  return v_result;
end; $$;

create or replace function public.set_payment_status(p_pagamento_id uuid, p_status public.status_pagamento)
returns public.pagamentos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_before public.pagamentos%rowtype; v_result public.pagamentos%rowtype; v_event text;
begin
  if not public.is_admin() then raise exception 'Acesso financeiro negado.' using errcode='42501'; end if;
  if p_status not in ('cancelado','estornado') then raise exception 'Status invalido.' using errcode='23514'; end if;
  select * into v_before from public.pagamentos where id=p_pagamento_id for update;
  if not found or v_before.status <> 'pago' then raise exception 'Pagamento nao pode ser alterado.' using errcode='23514'; end if;
  update public.pagamentos set status=p_status,updated_by=v_actor where id=v_before.id returning * into v_result;
  v_event := case when p_status='cancelado' then 'pagamento_cancelado' else 'pagamento_estornado' end;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
    values(v_actor,v_event,'pagamentos',v_result.id,jsonb_build_object('status_anterior',v_before.status,'status_novo',v_result.status));
  return v_result;
end; $$;

create or replace function public.list_payment_references(p_paciente_id uuid)
returns table(tipo text, id uuid, descricao text)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_active_user() then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if public.can_manage_financial() then
    return query
      select 'atendimento'::text, atendimento.id, 'Atendimento de ' || atendimento.iniciado_em::date::text
      from public.atendimentos atendimento where atendimento.paciente_id=p_paciente_id
      union all
      select 'orcamento'::text, orcamento.id, 'Orcamento #' || orcamento.numero::text
      from public.orcamentos orcamento where orcamento.paciente_id=p_paciente_id and orcamento.status='aprovado';
  elsif public.is_active_dentist() then
    return query select 'atendimento'::text, atendimento.id, 'Atendimento de ' || atendimento.iniciado_em::date::text
      from public.atendimentos atendimento where atendimento.paciente_id=p_paciente_id and atendimento.profissional_id=public.current_professional_id();
  else
    raise exception 'Acesso negado.' using errcode='42501';
  end if;
end; $$;

create or replace function public.list_payments(
  p_query text default null,
  p_paciente_id uuid default null,
  p_data_inicio date default null,
  p_data_fim date default null,
  p_forma public.forma_pagamento default null,
  p_status public.status_pagamento default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table(id uuid,paciente_id uuid,paciente_nome text,atendimento_id uuid,orcamento_id uuid,referencia text,valor_centavos integer,forma public.forma_pagamento,status public.status_pagamento,data_pagamento date,responsavel_nome text,total_count bigint)
language plpgsql security definer set search_path = '' stable as $$
declare v_manage boolean := public.can_manage_financial(); v_page integer := greatest(coalesce(p_page,1),1); v_size integer := least(greatest(coalesce(p_page_size,20),1),100);
begin
  if not public.is_active_user() then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if not v_manage and not public.is_active_dentist() then raise exception 'Acesso negado.' using errcode='42501'; end if;
  return query
  select pagamento.id,pagamento.paciente_id,paciente.nome,pagamento.atendimento_id,pagamento.orcamento_id,
    case when pagamento.atendimento_id is not null then 'Atendimento de ' || atendimento.iniciado_em::date::text when pagamento.orcamento_id is not null then 'Orcamento #' || orcamento.numero::text else 'Paciente' end,
    pagamento.valor_centavos,pagamento.forma,pagamento.status,pagamento.data_pagamento,criador.nome,count(*) over()
  from public.pagamentos pagamento
  join public.pacientes paciente on paciente.id=pagamento.paciente_id
  left join public.atendimentos atendimento on atendimento.id=pagamento.atendimento_id
  left join public.orcamentos orcamento on orcamento.id=pagamento.orcamento_id
  join public.usuarios criador on criador.id=pagamento.created_by
  where (v_manage or atendimento.profissional_id=public.current_professional_id())
    and (p_paciente_id is null or pagamento.paciente_id=p_paciente_id)
    and (p_data_inicio is null or pagamento.data_pagamento>=p_data_inicio)
    and (p_data_fim is null or pagamento.data_pagamento<=p_data_fim)
    and (p_forma is null or pagamento.forma=p_forma)
    and (p_status is null or pagamento.status=p_status)
    and (p_query is null or btrim(p_query)='' or paciente.nome ilike ('%' || btrim(p_query) || '%'))
  order by pagamento.data_pagamento desc,pagamento.created_at desc,pagamento.id
  offset (v_page-1)*v_size limit v_size;
end; $$;

create or replace function public.get_payment_summary(p_data_inicio date, p_data_fim date)
returns table(recebido_hoje_centavos bigint,recebido_periodo_centavos bigint,quantidade_pagamentos bigint)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_admin() then raise exception 'Acesso financeiro negado.' using errcode='42501'; end if;
  return query select
    coalesce(sum(pagamento.valor_centavos) filter (where pagamento.status='pago' and pagamento.data_pagamento=current_date),0)::bigint,
    coalesce(sum(pagamento.valor_centavos) filter (where pagamento.status='pago' and pagamento.data_pagamento between coalesce(p_data_inicio,current_date) and coalesce(p_data_fim,current_date)),0)::bigint,
    count(*) filter (where pagamento.status='pago')::bigint
  from public.pagamentos pagamento;
end; $$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in ('usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada','paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados','agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido','atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada','documento_criado','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado','pagamento_criado','pagamento_cancelado','pagamento_estornado'));

revoke execute on function public.can_manage_financial(),public.can_access_own_payment(uuid),public.create_payment(uuid,uuid,uuid,integer,public.forma_pagamento,date,text),public.set_payment_status(uuid,public.status_pagamento),public.list_payment_references(uuid),public.list_payments(text,uuid,date,date,public.forma_pagamento,public.status_pagamento,integer,integer),public.get_payment_summary(date,date) from public,anon;
grant execute on function public.can_manage_financial(),public.can_access_own_payment(uuid),public.create_payment(uuid,uuid,uuid,integer,public.forma_pagamento,date,text),public.set_payment_status(uuid,public.status_pagamento),public.list_payment_references(uuid),public.list_payments(text,uuid,date,date,public.forma_pagamento,public.status_pagamento,integer,integer),public.get_payment_summary(date,date) to authenticated;
commit;
