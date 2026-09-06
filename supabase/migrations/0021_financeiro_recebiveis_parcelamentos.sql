-- Sprint 20: recebiveis e parcelamentos. Aditiva; migrations 0001-0020 permanecem imutaveis.
begin;

do $$ begin
  create type public.status_recebivel as enum ('pendente', 'parcialmente_pago', 'pago', 'cancelado');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.status_parcela_financeira as enum ('pendente', 'paga', 'cancelada');
exception when duplicate_object then null;
end $$;

create table public.financeiro_recebiveis (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  atendimento_id uuid references public.atendimentos(id) on delete restrict,
  orcamento_id uuid references public.orcamentos(id) on delete restrict,
  valor_total_centavos integer not null,
  data_criacao date not null default public.clinic_today(),
  status public.status_recebivel not null default 'pendente',
  observacao_administrativa text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint financeiro_recebiveis_valor_valido check (valor_total_centavos > 0),
  constraint financeiro_recebiveis_origem_unica check (num_nonnulls(atendimento_id, orcamento_id) <= 1),
  constraint financeiro_recebiveis_observacao_valida check (
    observacao_administrativa is null or (
      observacao_administrativa = btrim(observacao_administrativa)
      and char_length(observacao_administrativa) between 1 and 1000
    )
  )
);

create table public.financeiro_parcelas (
  id uuid primary key default gen_random_uuid(),
  recebivel_id uuid not null references public.financeiro_recebiveis(id) on delete restrict,
  numero_parcela integer not null,
  total_parcelas integer not null,
  valor_centavos integer not null,
  vencimento date not null,
  status public.status_parcela_financeira not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint financeiro_parcelas_numero_valido check (numero_parcela between 1 and total_parcelas),
  constraint financeiro_parcelas_total_valido check (total_parcelas between 1 and 120),
  constraint financeiro_parcelas_valor_valido check (valor_centavos > 0),
  constraint financeiro_parcelas_numero_unico unique (recebivel_id, numero_parcela)
);

create index financeiro_recebiveis_paciente_status_idx
  on public.financeiro_recebiveis(paciente_id, status, data_criacao desc, id);
create index financeiro_recebiveis_orcamento_idx
  on public.financeiro_recebiveis(orcamento_id) where orcamento_id is not null;
create index financeiro_recebiveis_atendimento_idx
  on public.financeiro_recebiveis(atendimento_id) where atendimento_id is not null;
create index financeiro_parcelas_recebivel_vencimento_idx
  on public.financeiro_parcelas(recebivel_id, vencimento, numero_parcela);
create index financeiro_parcelas_pendentes_vencimento_idx
  on public.financeiro_parcelas(vencimento, id) where status = 'pendente';

create trigger financeiro_recebiveis_set_updated_at
  before update on public.financeiro_recebiveis for each row execute function public.set_updated_at();
create trigger financeiro_parcelas_set_updated_at
  before update on public.financeiro_parcelas for each row execute function public.set_updated_at();

-- Pagamentos legados permanecem sem parcela. Somente os novos recebimentos
-- parcelados usam a FK nullable abaixo.
alter table public.pagamentos add column parcela_id uuid references public.financeiro_parcelas(id) on delete restrict;
alter table public.pagamentos drop constraint pagamentos_um_vinculo;
alter table public.pagamentos add constraint pagamentos_origem_ou_parcela_unica
  check (num_nonnulls(atendimento_id, orcamento_id, parcela_id) <= 1);
create index pagamentos_parcela_idx on public.pagamentos(parcela_id) where parcela_id is not null;
create unique index pagamentos_parcela_paga_unica_idx
  on public.pagamentos(parcela_id) where parcela_id is not null and status = 'pago';

alter table public.financeiro_recebiveis enable row level security;
alter table public.financeiro_parcelas enable row level security;
create policy financeiro_recebiveis_select on public.financeiro_recebiveis for select to authenticated using (
  public.is_active_user() and public.can_manage_financial()
);
create policy financeiro_parcelas_select on public.financeiro_parcelas for select to authenticated using (
  public.is_active_user() and public.can_manage_financial() and exists (
    select 1 from public.financeiro_recebiveis recebivel
    where recebivel.id = recebivel_id
  )
);
revoke insert, update, delete on public.financeiro_recebiveis, public.financeiro_parcelas from anon, authenticated;
grant select on public.financeiro_recebiveis, public.financeiro_parcelas to authenticated;
grant all on public.financeiro_recebiveis, public.financeiro_parcelas to service_role;

create function public.assert_receivable_installments_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recebivel_id uuid := case when tg_op = 'DELETE' then old.recebivel_id else new.recebivel_id end;
  v_total integer;
  v_parcelas_total bigint;
begin
  select valor_total_centavos into v_total
  from public.financeiro_recebiveis where id = v_recebivel_id;
  if not found then return null; end if;
  select coalesce(sum(valor_centavos), 0) into v_parcelas_total
  from public.financeiro_parcelas where recebivel_id = v_recebivel_id;
  if v_parcelas_total <> v_total then
    raise exception 'A soma das parcelas deve corresponder ao valor total do recebivel.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger financeiro_parcelas_total_confere
after insert or update or delete on public.financeiro_parcelas
deferrable initially deferred for each row execute function public.assert_receivable_installments_total();

create function public.refresh_receivable_status(p_recebivel_id uuid)
returns public.financeiro_recebiveis language plpgsql security definer set search_path = '' as $$
declare
  v_recebivel public.financeiro_recebiveis%rowtype;
  v_pago bigint;
  v_status public.status_recebivel;
begin
  select * into v_recebivel from public.financeiro_recebiveis where id = p_recebivel_id for update;
  if not found then raise exception 'Recebivel nao encontrado.' using errcode = 'P0002'; end if;
  if v_recebivel.status = 'cancelado' then return v_recebivel; end if;
  select coalesce(sum(parcela.valor_centavos) filter (where pagamento.id is not null), 0)
    into v_pago
  from public.financeiro_parcelas parcela
  left join public.pagamentos pagamento on pagamento.parcela_id = parcela.id and pagamento.status = 'pago'
  where parcela.recebivel_id = v_recebivel.id;
  v_status := case
    when v_pago = 0 then 'pendente'::public.status_recebivel
    when v_pago < v_recebivel.valor_total_centavos then 'parcialmente_pago'::public.status_recebivel
    else 'pago'::public.status_recebivel
  end;
  update public.financeiro_recebiveis set status = v_status where id = v_recebivel.id returning * into v_recebivel;
  return v_recebivel;
end;
$$;

create function public.sync_receivable_after_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.parcela_id is not null then
    perform public.refresh_receivable_status((select recebivel_id from public.financeiro_parcelas where id = old.parcela_id));
  end if;
  if new.parcela_id is not null then
    perform public.refresh_receivable_status((select recebivel_id from public.financeiro_parcelas where id = new.parcela_id));
  end if;
  return new;
end;
$$;

create trigger pagamentos_sincroniza_recebivel
after insert or update of status, parcela_id on public.pagamentos
for each row
execute function public.sync_receivable_after_payment();

create function public.create_financial_receivable(
  p_paciente_id uuid,
  p_atendimento_id uuid,
  p_orcamento_id uuid,
  p_valor_total_centavos integer,
  p_primeiro_vencimento date,
  p_numero_parcelas integer default 1,
  p_intervalo_meses integer default 1,
  p_observacao_administrativa text default null
)
returns public.financeiro_recebiveis language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_recebivel public.financeiro_recebiveis%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_orcamento public.orcamentos%rowtype;
  v_base integer;
  v_resto integer;
  v_numero integer;
  v_vencimento date;
begin
  if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode = '42501'; end if;
  if p_valor_total_centavos is null or p_valor_total_centavos <= 0 then raise exception 'Valor total invalido.' using errcode = '23514'; end if;
  if p_numero_parcelas is null or p_numero_parcelas not between 1 and 120 then raise exception 'Numero de parcelas invalido.' using errcode = '23514'; end if;
  if p_intervalo_meses is null or p_intervalo_meses not between 1 and 24 then raise exception 'Intervalo de parcelas invalido.' using errcode = '23514'; end if;
  if p_primeiro_vencimento is null then raise exception 'Informe o primeiro vencimento.' using errcode = '23514'; end if;
  if num_nonnulls(p_atendimento_id, p_orcamento_id) > 1 then raise exception 'Vinculos conflitantes.' using errcode = '23514'; end if;
  if not exists(select 1 from public.pacientes where id = p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode = '23514'; end if;
  if p_atendimento_id is not null then
    select * into v_atendimento from public.atendimentos where id = p_atendimento_id for key share;
    if not found or v_atendimento.paciente_id is distinct from p_paciente_id then raise exception 'Atendimento invalido para o paciente.' using errcode = '23514'; end if;
  end if;
  if p_orcamento_id is not null then
    select * into v_orcamento from public.orcamentos where id = p_orcamento_id for key share;
    if not found or v_orcamento.paciente_id is distinct from p_paciente_id or v_orcamento.status <> 'aprovado' then raise exception 'Orcamento invalido para recebivel.' using errcode = '23514'; end if;
  end if;
  insert into public.financeiro_recebiveis(
    paciente_id, atendimento_id, orcamento_id, valor_total_centavos, data_criacao,
    observacao_administrativa, created_by, updated_by
  ) values (
    p_paciente_id, p_atendimento_id, p_orcamento_id, p_valor_total_centavos, public.clinic_today(),
    nullif(btrim(p_observacao_administrativa), ''), v_actor, v_actor
  ) returning * into v_recebivel;
  v_base := p_valor_total_centavos / p_numero_parcelas;
  v_resto := p_valor_total_centavos % p_numero_parcelas;
  for v_numero in 1..p_numero_parcelas loop
    v_vencimento := (p_primeiro_vencimento + ((v_numero - 1) * p_intervalo_meses * interval '1 month'))::date;
    insert into public.financeiro_parcelas(
      recebivel_id, numero_parcela, total_parcelas, valor_centavos, vencimento, created_by, updated_by
    ) values (
      v_recebivel.id, v_numero, p_numero_parcelas, v_base + case when v_numero <= v_resto then 1 else 0 end,
      v_vencimento, v_actor, v_actor
    );
  end loop;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados) values
    (v_actor, 'recebivel_criado', 'financeiro_recebiveis', v_recebivel.id,
      jsonb_build_object('paciente_id', p_paciente_id, 'atendimento_id', p_atendimento_id, 'orcamento_id', p_orcamento_id)),
    (v_actor, 'parcelamento_criado', 'financeiro_recebiveis', v_recebivel.id,
      jsonb_build_object('recebivel_id', v_recebivel.id, 'quantidade_parcelas', p_numero_parcelas));
  return v_recebivel;
end;
$$;

create function public.register_installment_payment(
  p_parcela_id uuid,
  p_forma public.forma_pagamento,
  p_data_pagamento date default public.clinic_today(),
  p_observacao_administrativa text default null
)
returns public.pagamentos language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_parcela public.financeiro_parcelas%rowtype;
  v_recebivel public.financeiro_recebiveis%rowtype;
  v_pagamento public.pagamentos%rowtype;
begin
  if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode = '42501'; end if;
  if p_forma is null then raise exception 'Forma de pagamento invalida.' using errcode = '23514'; end if;
  select * into v_parcela from public.financeiro_parcelas where id = p_parcela_id for update;
  if not found or v_parcela.status <> 'pendente' then raise exception 'Parcela nao esta disponivel para pagamento.' using errcode = '23514'; end if;
  select * into v_recebivel from public.financeiro_recebiveis where id = v_parcela.recebivel_id for update;
  if v_recebivel.status = 'cancelado' then raise exception 'Recebivel cancelado.' using errcode = '23514'; end if;
  insert into public.pagamentos(
    paciente_id, parcela_id, valor_centavos, forma, status, data_pagamento,
    observacao_administrativa, created_by, updated_by
  ) values (
    v_recebivel.paciente_id, v_parcela.id, v_parcela.valor_centavos, p_forma, 'pago',
    coalesce(p_data_pagamento, public.clinic_today()), nullif(btrim(p_observacao_administrativa), ''), v_actor, v_actor
  ) returning * into v_pagamento;
  update public.financeiro_parcelas set status = 'paga', updated_by = v_actor where id = v_parcela.id;
  perform public.refresh_receivable_status(v_recebivel.id);
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados) values
    (v_actor, 'parcela_paga', 'financeiro_parcelas', v_parcela.id,
      jsonb_build_object('recebivel_id', v_recebivel.id, 'pagamento_id', v_pagamento.id, 'forma', p_forma));
  return v_pagamento;
exception when unique_violation then
  raise exception 'Esta parcela ja possui pagamento confirmado.' using errcode = '23505';
end;
$$;

create function public.cancel_financial_receivable(p_recebivel_id uuid)
returns public.financeiro_recebiveis language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_recebivel public.financeiro_recebiveis%rowtype;
begin
  if not public.is_admin() then raise exception 'Cancelamento financeiro negado.' using errcode = '42501'; end if;
  select * into v_recebivel from public.financeiro_recebiveis where id = p_recebivel_id for update;
  if not found or v_recebivel.status = 'cancelado' then raise exception 'Recebivel nao pode ser cancelado.' using errcode = '23514'; end if;
  if exists (
    select 1 from public.financeiro_parcelas parcela
    join public.pagamentos pagamento on pagamento.parcela_id = parcela.id and pagamento.status = 'pago'
    where parcela.recebivel_id = v_recebivel.id
  ) then raise exception 'Recebivel com pagamento confirmado exige estorno antes do cancelamento.' using errcode = '23514'; end if;
  update public.financeiro_parcelas set status = 'cancelada', updated_by = v_actor
    where recebivel_id = v_recebivel.id and status = 'pendente';
  update public.financeiro_recebiveis set status = 'cancelado', updated_by = v_actor
    where id = v_recebivel.id returning * into v_recebivel;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
    values(v_actor, 'recebivel_cancelado', 'financeiro_recebiveis', v_recebivel.id, jsonb_build_object('recebivel_id', v_recebivel.id));
  return v_recebivel;
end;
$$;

-- Mantem o fluxo legado e faz estorno/cancelamento de pagamento de parcela
-- restaurar a disponibilidade da parcela e a situacao do recebivel.
create or replace function public.set_payment_status(p_pagamento_id uuid, p_status public.status_pagamento)
returns public.pagamentos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_before public.pagamentos%rowtype; v_result public.pagamentos%rowtype; v_event text;
begin
  if not public.is_admin() then raise exception 'Acesso financeiro negado.' using errcode='42501'; end if;
  if p_status not in ('cancelado','estornado') then raise exception 'Status invalido.' using errcode='23514'; end if;
  select * into v_before from public.pagamentos where id=p_pagamento_id for update;
  if not found or v_before.status <> 'pago' then raise exception 'Pagamento nao pode ser alterado.' using errcode='23514'; end if;
  update public.pagamentos set status=p_status,updated_by=v_actor where id=v_before.id returning * into v_result;
  if v_before.parcela_id is not null then
    update public.financeiro_parcelas set status='pendente', updated_by=v_actor where id=v_before.parcela_id;
  end if;
  v_event := case when p_status='cancelado' then 'pagamento_cancelado' else 'pagamento_estornado' end;
  insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados)
    values(v_actor,v_event,'pagamentos',v_result.id,jsonb_build_object('status_anterior',v_before.status,'status_novo',v_result.status));
  return v_result;
end; $$;

drop function public.get_payment_summary(date, date);
create function public.get_payment_summary(p_data_inicio date, p_data_fim date)
returns table(
  recebido_hoje_centavos bigint,
  recebido_periodo_centavos bigint,
  quantidade_pagamentos bigint,
  a_receber_centavos bigint,
  vencido_centavos bigint
)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_admin() then raise exception 'Acesso financeiro negado.' using errcode = '42501'; end if;
  return query select
    coalesce(sum(pagamento.valor_centavos) filter (where pagamento.status = 'pago' and pagamento.data_pagamento = public.clinic_today()), 0)::bigint,
    coalesce(sum(pagamento.valor_centavos) filter (where pagamento.status = 'pago' and pagamento.data_pagamento between coalesce(p_data_inicio, public.clinic_today()) and coalesce(p_data_fim, public.clinic_today())), 0)::bigint,
    count(*) filter (where pagamento.status = 'pago' and pagamento.data_pagamento between coalesce(p_data_inicio, public.clinic_today()) and coalesce(p_data_fim, public.clinic_today()))::bigint,
    (select coalesce(sum(parcela.valor_centavos), 0)::bigint from public.financeiro_parcelas parcela join public.financeiro_recebiveis recebivel on recebivel.id = parcela.recebivel_id where parcela.status = 'pendente' and recebivel.status <> 'cancelado'),
    (select coalesce(sum(parcela.valor_centavos), 0)::bigint from public.financeiro_parcelas parcela join public.financeiro_recebiveis recebivel on recebivel.id = parcela.recebivel_id where parcela.status = 'pendente' and recebivel.status <> 'cancelado' and parcela.vencimento < public.clinic_today())
  from public.pagamentos pagamento;
end;
$$;

create function public.list_financial_receivables(
  p_query text default null,
  p_paciente_id uuid default null,
  p_status public.status_recebivel default null,
  p_vencidos boolean default false,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table(
  id uuid, paciente_id uuid, paciente_nome text, atendimento_id uuid, orcamento_id uuid,
  referencia text, valor_total_centavos integer, valor_pago_centavos bigint, valor_aberto_centavos bigint,
  proximo_vencimento date, status public.status_recebivel, total_count bigint
)
language plpgsql security definer set search_path = '' stable as $$
declare v_page integer := greatest(coalesce(p_page,1),1); v_size integer := least(greatest(coalesce(p_page_size,20),1),100);
begin
  if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode = '42501'; end if;
  return query
  select recebivel.id, recebivel.paciente_id, paciente.nome, recebivel.atendimento_id, recebivel.orcamento_id,
    case when recebivel.atendimento_id is not null then 'Atendimento de ' || atendimento.iniciado_em::date::text when recebivel.orcamento_id is not null then 'Orcamento #' || orcamento.numero::text else 'Paciente' end,
    recebivel.valor_total_centavos,
    coalesce((select sum(parcela.valor_centavos) from public.financeiro_parcelas parcela join public.pagamentos pagamento on pagamento.parcela_id = parcela.id and pagamento.status = 'pago' where parcela.recebivel_id = recebivel.id), 0)::bigint,
    (recebivel.valor_total_centavos - coalesce((select sum(parcela.valor_centavos) from public.financeiro_parcelas parcela join public.pagamentos pagamento on pagamento.parcela_id = parcela.id and pagamento.status = 'pago' where parcela.recebivel_id = recebivel.id), 0))::bigint,
    (select min(parcela.vencimento) from public.financeiro_parcelas parcela where parcela.recebivel_id = recebivel.id and parcela.status = 'pendente'),
    recebivel.status, count(*) over()
  from public.financeiro_recebiveis recebivel
  join public.pacientes paciente on paciente.id = recebivel.paciente_id
  left join public.atendimentos atendimento on atendimento.id = recebivel.atendimento_id
  left join public.orcamentos orcamento on orcamento.id = recebivel.orcamento_id
  where (p_status is null or recebivel.status = p_status)
    and (not coalesce(p_vencidos, false) or exists (select 1 from public.financeiro_parcelas parcela where parcela.recebivel_id = recebivel.id and parcela.status = 'pendente' and parcela.vencimento < public.clinic_today()))
    and (p_paciente_id is null or recebivel.paciente_id = p_paciente_id)
    and (p_query is null or btrim(p_query) = '' or paciente.nome ilike ('%' || btrim(p_query) || '%'))
  order by (select min(parcela.vencimento) from public.financeiro_parcelas parcela where parcela.recebivel_id = recebivel.id and parcela.status = 'pendente') nulls last, recebivel.created_at desc, recebivel.id
  offset (v_page - 1) * v_size limit v_size;
end;
$$;

create function public.list_financial_installments(p_recebivel_id uuid)
returns table(
  id uuid, numero_parcela integer, total_parcelas integer, valor_centavos integer,
  vencimento date, status public.status_parcela_financeira, pagamento_id uuid, pagamento_status public.status_pagamento
)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.can_manage_financial() then raise exception 'Acesso financeiro negado.' using errcode = '42501'; end if;
  if not exists(select 1 from public.financeiro_recebiveis where id = p_recebivel_id) then raise exception 'Recebivel nao encontrado.' using errcode = 'P0002'; end if;
  return query
  select parcela.id, parcela.numero_parcela, parcela.total_parcelas, parcela.valor_centavos,
    parcela.vencimento, parcela.status, pagamento.id, pagamento.status
  from public.financeiro_parcelas parcela
  left join public.pagamentos pagamento on pagamento.parcela_id = parcela.id and pagamento.status = 'pago'
  where parcela.recebivel_id = p_recebivel_id
  order by parcela.numero_parcela;
end;
$$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','usuario_dados_atualizados','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','procedimento_dentes_atualizados',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','documento_preparado','documento_emitido','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado','orcamento_pdf_emitido',
  'pagamento_criado','pagamento_cancelado','pagamento_estornado','recebivel_criado','parcelamento_criado','parcela_paga','recebivel_cancelado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado',
  'servico_criado','servico_atualizado','servico_ativado','servico_inativado','servico_materiais_alterado','servico_realizado','servico_realizado_atualizado','estoque_consumido_atendimento',
  'controle_lote_ativado','controle_lote_desativado','estoque_lote_entrada','estoque_lote_saida','estoque_lote_ajuste','lote_atualizado','lote_ativado','lote_inativado',
  'equipamento_esterilizacao_criado','equipamento_esterilizacao_atualizado','ciclo_esterilizacao_iniciado','ciclo_esterilizacao_concluido','ciclo_esterilizacao_reprovado','ciclo_esterilizacao_cancelado','pacote_esterilizacao_criado','pacote_esterilizacao_utilizado','pacote_esterilizacao_descartado'
));

revoke execute on function public.assert_receivable_installments_total(), public.refresh_receivable_status(uuid), public.sync_receivable_after_payment() from public, anon, authenticated;
revoke execute on function public.create_financial_receivable(uuid,uuid,uuid,integer,date,integer,integer,text), public.register_installment_payment(uuid,public.forma_pagamento,date,text), public.cancel_financial_receivable(uuid), public.list_financial_receivables(text,uuid,public.status_recebivel,boolean,integer,integer), public.list_financial_installments(uuid) from public, anon;
grant execute on function public.create_financial_receivable(uuid,uuid,uuid,integer,date,integer,integer,text), public.register_installment_payment(uuid,public.forma_pagamento,date,text), public.cancel_financial_receivable(uuid), public.list_financial_receivables(text,uuid,public.status_recebivel,boolean,integer,integer), public.list_financial_installments(uuid) to authenticated;
revoke execute on function public.get_payment_summary(date,date) from public, anon;
grant execute on function public.get_payment_summary(date,date) to authenticated;

commit;
