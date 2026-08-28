-- Sprint 11: hardening aditivo para homologacoes ficticias que receberam o WIP 0007/0008.
-- A 0012 permanece imutavel. As assinaturas antigas permitiam alterar valor e status.
begin;

-- O enum foi estendido na 0012; somente depois daquele commit e seguro
-- converter o valor legado usado exclusivamente pelo WIP de homologacao.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pagamentos' and column_name = 'forma') then
    update public.pagamentos
      set forma = 'cartao_credito'::public.forma_pagamento
      where forma::text = 'cartao';
  end if;
end $$;

drop function if exists public.create_payment(uuid, uuid, uuid, uuid, date, integer, public.forma_pagamento, public.status_pagamento, text);
drop function if exists public.update_payment(uuid, date, integer, public.forma_pagamento, public.status_pagamento, text);
drop function if exists public.cancel_payment(uuid);

create or replace function public.get_payment_summary(p_data_inicio date, p_data_fim date)
returns table(recebido_hoje_centavos bigint, recebido_periodo_centavos bigint, quantidade_pagamentos bigint)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso financeiro negado.' using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(pagamento.valor_centavos) filter (where pagamento.status = 'pago' and pagamento.data_pagamento = current_date), 0)::bigint,
    coalesce(sum(pagamento.valor_centavos) filter (where pagamento.status = 'pago' and pagamento.data_pagamento between coalesce(p_data_inicio, current_date) and coalesce(p_data_fim, current_date)), 0)::bigint,
    count(*) filter (where pagamento.status = 'pago' and pagamento.data_pagamento between coalesce(p_data_inicio, current_date) and coalesce(p_data_fim, current_date))::bigint
  from public.pagamentos pagamento;
end;
$$;

revoke execute on function public.get_payment_summary(date, date) from public, anon;
grant execute on function public.get_payment_summary(date, date) to authenticated;

commit;
